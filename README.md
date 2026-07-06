# The House Hub Backend

Express API for The House Hub property management platform.

## Required Environment

Copy `.env.example` to `.env` locally and configure the same variables in production.

Critical variables:

- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_SECRET`: long random secret used to sign auth tokens.
- `FRONTEND_URL`: public frontend login URL.
- `SMTP_*` and `EMAIL_FROM`: outbound email provider.
- `CLOUDINARY_*`: image/document storage credentials when Cloudinary-backed uploads are used.

## Production Commands

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate
npm start
```

## Launch Checks

```bash
npm test
npx prisma validate
```

The API exposes `/api/health` for uptime checks.
