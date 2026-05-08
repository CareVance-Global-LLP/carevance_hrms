Objective: reduce build time and memory usage on small Lightsail instances without breaking deployments.

Immediate safe changes (non-breaking):

1) .dockerignore (added) — reduces Docker build context transfer and speeds builds.

2) Use CI to build images and push to a registry (GitHub Container Registry or Docker Hub):
   - CI job: build frontend/backend images and push tags.
   - In deploy, replace `build:` with `image: ghcr.io/<org>/backend:latest` and `image: ghcr.io/<org>/frontend:latest` so the server pulls images instead of building.

3) Create swap (one-time on server) to avoid OOM during builds:
   sudo fallocate -l 1G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

4) Log management: truncate or rotate large logs before restart:
   sudo truncate -s 0 /path/to/project/frontend/vite-dev.log
   sudo truncate -s 0 /path/to/project/backend/carevance-backend-local.log

   Prefer adding logrotate config for /path/to/project/*/*.log.

5) Docker cleanup (safe if services can be restarted):
   docker system prune -af
   docker volume prune -f

6) If using npm/composer builds on instance, add --production, npm ci, and set NODE_ENV=production to reduce install size.

7) If slowness persists, upgrade to Lightsail plan with >=2GB RAM or move DB to managed Postgres.

Non-invasive next steps I can do now in the repo:
- Add sample CI workflow to build/push images
- Add example docker-compose.production.yml that uses image: tags
- Add logrotate config template

Which of these should be applied next? (I can open a PR with the .dockerignore and notes now.)
