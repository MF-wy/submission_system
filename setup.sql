BEGIN;

ALTER TABLE public.reviews
    ADD COLUMN IF NOT EXISTS return_reason TEXT;

INSERT INTO public.users (username, password_hash, role)
VALUES
    ('submission_demo_author', '!no-login', 'author'),
    ('submission_demo_editor', '!no-login', 'editor')
ON CONFLICT (username) DO NOTHING;

COMMIT;
