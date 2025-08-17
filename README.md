# MaxTT Billing App

This is the MaxTT Tyre Sealant Billing & Dosage Calculator Web App.

## 🚀 Deploying on Vercel (5 min)

1. Go to https://vercel.com and sign in with Google/GitHub
2. Click **'Add New Project'**
3. Choose **'Import Project'** > then select **Upload**
4. Upload the contents of this folder (unzipped)
5. Vercel will auto-detect React. Just click **Deploy**.
6. Your app will be live at something like `https://maxtt.vercel.app`

Enjoy full control — no vendor lock-in.

---

## Features
- Dosage calculation using tyre dimensions
- Auto-GST + discount + per ml pricing logic
- PDF invoice generation with indemnity clause
- Modular React app (future ready for dashboard, login, DB)
{
  "scripts": {
    "build": "npm run prisma:generate && tsc -p . && next build || true",
    "start": "NODE_ENV=production node dist/server.js || next start -p $PORT",
    "prisma:generate": "prisma generate",
    "migrate:deploy": "prisma migrate deploy",
    "db:seed": "ts-node prisma/seed.ts",
    "gst:remind": "node dist/workers/gst-remind.js"
  }
}
