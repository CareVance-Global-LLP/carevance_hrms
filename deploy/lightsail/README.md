# Lightsail Deployment

This folder deploys the CareVance stack on a single AWS Lightsail Ubuntu instance using Docker Compose.

Services included:

- `frontend`: React app served by Nginx on port `80`
- `backend`: Laravel API on port `8000`
- `queue`: Laravel queue worker
- `db`: PostgreSQL 16

## 1. Lightsail Instance

Recommended minimum:

- Ubuntu 22.04 or 24.04
- 2 GB RAM or higher

Open these firewall ports in Lightsail networking:

- `22` for SSH
- `80` for frontend
- `8000` for backend API

## 2. Install Docker On The Server

Run these commands on the Lightsail instance:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

## 3. Copy The Project

Option A: clone from GitHub

```bash
git clone https://github.com/Igrisssssss/carevance_hrms.git
cd carevance_hrms
```

Option B: upload your local repo to the server and `cd` into it.

## 4. Prepare Environment

```bash
cd deploy/lightsail
cp .env.example .env
```

Edit `.env` and set at least:

- `APP_KEY`
- `APP_URL`
- `FRONTEND_APP_URL`
- `FRONTEND_URL`
- `CORS_ALLOWED_ORIGINS`
- `CORS_ALLOWED_ORIGIN_PATTERNS`
- `DB_PASSWORD`
- `IDLE_TRACK_THRESHOLD_SECONDS`
- `IDLE_AUTO_STOP_THRESHOLD_SECONDS`
- `MAIL_*` if you want invitations and mail
- `STRIPE_*` if payouts will use Stripe

Generate a Laravel app key locally or on the server:

```bash
docker compose run --rm backend php artisan key:generate --show
```

Paste that output into `APP_KEY=` inside `deploy/lightsail/.env`.

## 5. Build And Start

From `deploy/lightsail`:

```bash
docker compose up -d --build
```

## 6. Verify

Frontend:

```bash
curl http://YOUR_LIGHTSAIL_PUBLIC_IP/health
```

Backend:

```bash
curl http://YOUR_LIGHTSAIL_PUBLIC_IP:8000/up
```

Container status:

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f queue
```

## 7. Updating After New Git Changes

```bash
cd ~/carevance_hrms
git pull
cd deploy/lightsail
docker compose up -d --build
docker compose exec -T backend php artisan screenshots:health-check
docker compose exec -T backend php artisan idle:health-check
```

Important:

- Do not regenerate `APP_KEY` on updates. Keep the same key from first deployment.
- Keep `APP_URL` and `VITE_API_URL` aligned with the deployed backend URL on every update.

## 8. CI/CD Without Building On Lightsail

This repo now includes a GitHub Actions workflow at `.github/workflows/deploy-lightsail.yml`.

Recommended flow:

- GitHub Actions builds the `backend` and `frontend` Docker images
- GitHub pushes those images to GHCR
- Lightsail pulls the ready-made images and restarts the stack
- No `npm run build` or `docker build` runs on the Lightsail server

### One-time server setup

Install Docker on the server and clone the repo as described above, then:

```bash
cd ~/carevance_hrms/deploy/lightsail
cp .env.example .env
```

Fill in `.env` with your production values.

### GitHub secrets to add

In your GitHub repository settings, add these secrets:

- `LIGHTSAIL_HOST`: your public Lightsail IP or domain
- `LIGHTSAIL_USERNAME`: usually `ubuntu`
- `LIGHTSAIL_SSH_KEY`: the private SSH key content used to connect to Lightsail
- `GHCR_READ_TOKEN`: a GitHub token with at least `read:packages` and repo access

### First manual deploy using prebuilt images

Pick image names that match your repo and owner. Example:

```bash
export BACKEND_IMAGE=ghcr.io/YOUR_GITHUB_USERNAME/carevance_hrms-backend:main
export FRONTEND_IMAGE=ghcr.io/YOUR_GITHUB_USERNAME/carevance_hrms-frontend:main
docker login ghcr.io
docker compose -f docker-compose.deploy.yml pull
docker compose -f docker-compose.deploy.yml up -d
```

After that, every push to `main` can deploy automatically through GitHub Actions.

### Notes

- `docker-compose.yml` is still the local/manual build-on-server option
- `docker-compose.deploy.yml` is the CI/CD option that pulls prebuilt images
- if you change `deploy/lightsail/.env`, those env changes still live on the server and are picked up on the next deploy
- the workflow currently deploys from `/var/www/carevance`; change that path in the workflow if your server uses a different folder

## Notes

- The backend container runs `php artisan migrate --force` on startup.
- PostgreSQL data persists in the `postgres_data` Docker volume.
- Laravel storage persists in the `backend_storage` Docker volume.
- This setup is HTTP-first for fast Lightsail deployment. Once the stack is stable, move to a domain plus HTTPS and update the `APP_URL`, `FRONTEND_APP_URL`, `VITE_WEB_APP_URL`, and Stripe return URLs accordingly.
