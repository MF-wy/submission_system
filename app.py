import os
from contextlib import asynccontextmanager, contextmanager
from typing import Annotated, Literal

import psycopg
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout
from pydantic import BaseModel, StringConstraints

AUTHOR = "submission_demo_author"
EDITOR = "submission_demo_editor"

@asynccontextmanager
async def lifespan(app: FastAPI):
    dsn = os.getenv("DATABASE_URL")
    app.state.db_pool = None
    if not dsn:
        yield
        return

    with ConnectionPool(
        conninfo=dsn,
        kwargs={"row_factory": dict_row, "prepare_threshold": None, "connect_timeout": 10},
        min_size=1,
        max_size=3,
        timeout=25,
        open=False,
    ) as pool:
        app.state.db_pool = pool
        yield


app = FastAPI(title="稿件室 API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8000", "http://localhost:8000",
        "http://127.0.0.1:8002", "http://localhost:8002",
    ],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]


class PaperInput(BaseModel):
    category: ShortText
    title: Title
    content: LongText


class ReturnInput(BaseModel):
    reason: LongText


@contextmanager
def database():
    pool = app.state.db_pool
    if pool is None:
        raise HTTPException(503, "請先設定 DATABASE_URL。")
    try:
        with pool.connection() as db:
            yield db
    except (PoolTimeout, psycopg.OperationalError) as error:
        raise HTTPException(503, "資料庫暫時無法連線，請稍後重試。") from error


def demo_user(db, username, role):
    row = db.execute(
        "SELECT user_id FROM public.users WHERE username = %s AND role = %s",
        (username, role),
    ).fetchone()
    if row is None:
        raise HTTPException(503, "缺少示範帳號，請先執行 setup.sql。")
    return row["user_id"]


def require_article(row):
    if row is None:
        raise HTTPException(409, "稿件已不存在或審查狀態已變更，請重新整理。")
    return row


@app.get("/papers")
def list_papers(role: Literal["author", "editor"], include_approved: bool = False):
    with database() as db:
        if role == "author":
            condition = "a.author_id = %s"
            value = demo_user(db, AUTHOR, "author")
        else:
            condition = "a.status = ANY(%s)"
            value = ["審查中", "已通過"] if include_approved else ["審查中"]
        return db.execute(
            f"""
            SELECT a.article_id AS id, a.category, a.title, a.content,
                   CASE a.status WHEN '編輯中' THEN 'draft'
                       WHEN '審查中' THEN 'review' WHEN '已通過' THEN 'approved' END AS status,
                   CASE WHEN u.username = %s THEN '示範作者' ELSE u.username END AS author,
                   (a.status = '編輯中' AND latest.decision IS NOT DISTINCT FROM '退回') AS returned,
                   CASE WHEN a.status = '編輯中' AND latest.decision = '退回'
                        THEN latest.return_reason END AS return_reason
            FROM public.articles a
            JOIN public.users u ON u.user_id = a.author_id
            LEFT JOIN LATERAL (
                SELECT decision, return_reason FROM public.reviews r
                WHERE r.article_id = a.article_id ORDER BY review_id DESC LIMIT 1
            ) latest ON true
            WHERE {condition}
            ORDER BY a.article_id DESC
            """,
            (AUTHOR, value),
        ).fetchall()


@app.post("/papers", status_code=201)
def create_paper(paper: PaperInput):
    with database() as db:
        author_id = demo_user(db, AUTHOR, "author")
        return db.execute(
            """INSERT INTO public.articles (author_id, category, title, content)
               VALUES (%s, %s, %s, %s) RETURNING article_id AS id""",
            (author_id, paper.category, paper.title, paper.content),
        ).fetchone()


@app.put("/papers/{paper_id}")
def edit_paper(paper_id: int, paper: PaperInput):
    with database() as db:
        author_id = demo_user(db, AUTHOR, "author")
        return require_article(db.execute(
            """UPDATE public.articles SET category = %s, title = %s, content = %s,
                      updated_at = CURRENT_TIMESTAMP
               WHERE article_id = %s AND author_id = %s AND status = '編輯中'
               RETURNING article_id AS id""",
            (paper.category, paper.title, paper.content, paper_id, author_id),
        ).fetchone())


@app.delete("/papers/{paper_id}", status_code=204)
def delete_paper(paper_id: int):
    with database() as db:
        author_id = demo_user(db, AUTHOR, "author")
        require_article(db.execute(
            """SELECT article_id FROM public.articles
               WHERE article_id = %s AND author_id = %s AND status = '編輯中' FOR UPDATE""",
            (paper_id, author_id),
        ).fetchone())
        db.execute("DELETE FROM public.reviews WHERE article_id = %s", (paper_id,))
        db.execute("DELETE FROM public.articles WHERE article_id = %s", (paper_id,))
    return Response(status_code=204)


@app.post("/papers/{paper_id}/submit")
def submit_paper(paper_id: int):
    with database() as db:
        author_id = demo_user(db, AUTHOR, "author")
        return require_article(db.execute(
            """UPDATE public.articles SET status = '審查中', updated_at = CURRENT_TIMESTAMP
               WHERE article_id = %s AND author_id = %s AND status = '編輯中'
               RETURNING article_id AS id""",
            (paper_id, author_id),
        ).fetchone())


def record_review(paper_id, status, decision, reason=None):
    with database() as db:
        editor_id = demo_user(db, EDITOR, "editor")
        article = require_article(db.execute(
            """UPDATE public.articles SET status = %s, updated_at = CURRENT_TIMESTAMP
               WHERE article_id = %s AND status = '審查中' RETURNING article_id AS id""",
            (status, paper_id),
        ).fetchone())
        db.execute(
            """INSERT INTO public.reviews (article_id, editor_id, decision, return_reason)
               VALUES (%s, %s, %s, %s)""",
            (paper_id, editor_id, decision, reason),
        )
        return article


@app.post("/papers/{paper_id}/approve")
def approve_paper(paper_id: int):
    return record_review(paper_id, "已通過", "通過")


@app.post("/papers/{paper_id}/return")
def return_paper(paper_id: int, review: ReturnInput):
    return record_review(paper_id, "編輯中", "退回", review.reason)
