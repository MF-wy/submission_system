BEGIN;

CREATE TABLE IF NOT EXISTS public.users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('author', 'editor'))
);

CREATE TABLE IF NOT EXISTS public.articles (
    article_id SERIAL PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES public.users(user_id),
    category VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT '編輯中'
        CHECK (status IN ('編輯中', '審查中', '已通過')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.reviews (
    review_id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES public.articles(article_id),
    editor_id INTEGER NOT NULL REFERENCES public.users(user_id),
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('通過', '退回')),
    review_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
