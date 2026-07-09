# AI WP Builder — Backend

## Deploy to Railway (free)

1. Go to railway.app → New Project → Deploy from GitHub
2. Push this folder to a GitHub repo first
3. Add these environment variables in Railway dashboard:

```
ANTHROPIC_API_KEY=     your Claude API key from console.anthropic.com
SUPABASE_URL=          from Supabase project settings
SUPABASE_SERVICE_KEY=  from Supabase project settings → service_role key
FRONTEND_URL=          your Vercel app URL (add after deploying Next.js)
FREE_CREDITS=100
NODE_ENV=production
```

4. Railway auto-deploys. Your backend URL will be: https://yourapp.railway.app

## Setup Supabase

1. Go to supabase.com → New Project
2. Go to SQL Editor → New Query
3. Paste and run the entire contents of supabase-schema.sql
4. Go to Authentication → Providers → enable Google and GitHub
5. Copy your Project URL and service_role key into Railway env vars

## API Endpoints

POST   /api/auth/signup          Create account with email/password
POST   /api/auth/login           Login with email/password  
GET    /api/auth/oauth-url       Get Google/GitHub OAuth URL
GET    /api/auth/me              Get current user + credits

POST   /api/sites/connect        Connect a WordPress site
GET    /api/sites                List connected sites
GET    /api/sites/:id/context    Get site pages/settings
DELETE /api/sites/:id            Disconnect a site

POST   /api/chat/message         Send a chat message (uses credits)
GET    /api/chat/history         Load conversation history

GET    /api/credits              Check credit balance
GET    /api/credits/packages     List top-up packages

GET    /health                   Health check (Railway uses this)
