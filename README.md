# 稿件室

軟體工程期中作業。用同一個頁面的「作者」與「編輯」頁籤演示投稿審查。作者固定為「示範作者」，角色切換供課堂操作，沒有帳號登入或角色權限驗證。

## 啟動

需要 Python 3.10 以上、PHP 和 PostgreSQL。以下指令在 PowerShell 7 執行。

1. 在 PostgreSQL 建立 `submission_system` 資料庫。用 pgAdmin 開啟這個資料庫的 Query Tool，依序執行 `schema.sql` 和 `setup.sql`。前者建立三張表，後者加上退回理由欄位與課堂示範角色。

2. 在 pgAdmin 查看資料庫伺服器的「Properties → Connection」，將 Host 和 Port 填入下方指令。也可直接使用資料庫擁有者的帳號並跳過授權 SQL。若要使用專用帳號，可先在 pgAdmin 建立 Login Role，再到 `submission_system` 的 Query Tool 授權，以下以 `submission_app` 為例。

   ```sql
   GRANT CONNECT ON DATABASE submission_system TO submission_app;
   GRANT USAGE ON SCHEMA public TO submission_app;
   GRANT SELECT ON public.users TO submission_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON public.articles TO submission_app;
   GRANT SELECT, INSERT, DELETE ON public.reviews TO submission_app;
   GRANT USAGE ON SEQUENCE public.articles_article_id_seq, public.reviews_review_id_seq TO submission_app;
   ```

3. 在第一個終端機進入專案資料夾，填入連線資料後啟動 API。若套件已安裝，可以略過第一行。密碼在終端機輸入，關閉該終端機後這個環境變數就會消失。

   ```powershell
   python -m pip install --target .venv\packages -r requirements.txt
   $env:PYTHONPATH = Join-Path (Get-Location) '.venv\packages'
   $env:DATABASE_URL = "host=你的主機 port=5432 dbname=submission_system user=submission_app sslmode=require"
   $env:PGPASSWORD = Read-Host 'PostgreSQL 密碼' -MaskInput
   python -m uvicorn app:app --host 127.0.0.1 --port 8001
   ```

4. 在第二個終端機進入專案資料夾後啟動 PHP。使用瀏覽器開啟 [稿件室](http://127.0.0.1:8002/)。[FastAPI 文件](http://127.0.0.1:8001/docs)可用來查看和操作 API。

   ```powershell
   php -S 127.0.0.1:8002 -t .
   ```

## 上台操作

1. 留在「作者」，新增稿件，輸入類別、標題和文章內容並儲存。清單會顯示「編輯中」，可以編輯、刪除或送出。
2. 送出稿件後，狀態變成「審查中」。切到「編輯」，在清單中打開稿件閱讀。
3. 選「退回稿件」，輸入理由後確認。切回「作者」，同一篇稿件會顯示「編輯中」與「已退回」，打開即可看理由。
4. 修改後再次送出，切回「編輯」選「通過」。回到作者清單查看「已通過」。

## 怎麼解釋程式

| 檔案 | 負責的工作 |
| --- | --- |
| `index.php` | PHP 網頁入口，讀取獨立的 HTML 檔 |
| `index.html` | 角色頁籤、表格和對話框的結構 |
| `style.css` | 排版、配色、按鈕和狀態標籤 |
| `app.js` | 表單和按鈕操作，透過 `fetch` 呼叫 FastAPI |
| `app.py` | 驗證欄位、執行 SQL、限制稿件狀態轉換 |

每篇稿件是 `articles` 的一筆資料，透過 `author_id` 連到 `users`。通過或退回時，API 在同一筆交易更新 `articles.status` 並新增一筆 `reviews`。編輯中的稿件若最近一筆審查是退回，畫面會顯示退回理由。重新送出後，理由仍留在審查紀錄。刪除編輯中的稿件時會一併刪除該稿的審查紀錄，以符合外鍵限制。

作者與編輯頁下方都有「已通過稿件」，可開啟全文。

FastAPI 啟動時會預先建立 PostgreSQL 連線，請求之間透過連線池重複使用。每次操作仍會個別提交或回滾交易。
