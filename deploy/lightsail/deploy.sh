#!/bin/bash

# AWS Lightsail Deployment Script for CareVance HRMS
# This script automates the deployment process on AWS Lightsail

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=================================${NC}"
echo -e "${GREEN}CareVance HRMS Deployment Script${NC}"
echo -e "${GREEN}=================================${NC}"
echo ""

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo -e "${RED}This script should not be run as root${NC}"
   exit 1
fi

# Configuration
DEPLOY_DIR="$HOME/carevance"
COMPOSE_FILE="docker-compose.production.yml"
BACKUP_DIR="$HOME/backups"

# Create directories
mkdir -p "$DEPLOY_DIR"
mkdir -p "$BACKUP_DIR"

echo -e "${YELLOW}Step 1: Checking prerequisites...${NC}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker not found. Installing...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo -e "${GREEN}Docker installed successfully${NC}"
else
    echo -e "${GREEN}Docker is already installed${NC}"
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Docker Compose not found. Installing...${NC}"
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}Docker Compose installed successfully${NC}"
else
    echo -e "${GREEN}Docker Compose is already installed${NC}"
fi

echo -e "${YELLOW}Step 2: Setting up swap file...${NC}"

# Create swap file if it doesn't exist (important for Lightsail with <2GB RAM)
if [ ! -f /swapfile ]; then
    echo -e "${YELLOW}Creating 2GB swap file...${NC}"
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo -e "${GREEN}Swap file created successfully${NC}"
else
    echo -e "${GREEN}Swap file already exists${NC}"
fi

echo -e "${YELLOW}Step 3: Configuring system...${NC}"

# Optimize kernel parameters for PostgreSQL
echo -e "${YELLOW}Optimizing kernel parameters...${NC}"
sudo sysctl -w vm.swappiness=10
sudo sysctl -w vm.dirty_ratio=40
sudo sysctl -w vm.dirty_background_ratio=10

# Make kernel parameters persistent
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
echo "vm.dirty_ratio=40" | sudo tee -a /etc/sysctl.conf
echo "vm.dirty_background_ratio=10" | sudo tee -a /etc/sysctl.conf

echo -e "${YELLOW}Step 4: Cleaning up old containers and images...${NC}"

# Clean up old containers and images to free up space
cd "$DEPLOY_DIR"
docker system prune -f --volumes 2>/dev/null || true

echo -e "${YELLOW}Step 5: Pulling latest images...${NC}"

# Login to GitHub Container Registry
echo -e "${YELLOW}Please login to GitHub Container Registry...${NC}"
echo "You need a GitHub Personal Access Token with 'read:packages' scope"
echo ""
read -p "Enter your GitHub username: " GITHUB_USER
read -s -p "Enter your GitHub Personal Access Token: " GITHUB_TOKEN
echo ""

echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin

# Pull latest images
cd "$DEPLOY_DIR"
docker-compose -f "$COMPOSE_FILE" pull

echo -e "${YELLOW}Step 6: Stopping existing services...${NC}"

# Stop existing services gracefully
docker-compose -f "$COMPOSE_FILE" down --timeout 30 || true

echo -e "${YELLOW}Step 7: Starting services...${NC}"

# Start services
docker-compose -f "$COMPOSE_FILE" up -d

echo -e "${YELLOW}Step 8: Waiting for database to be ready...${NC}"

# Wait for database
sleep 10

# Check if database is ready
until docker-compose -f "$COMPOSE_FILE" exec -T db pg_isready -U "$DB_USERNAME" -d "$DB_DATABASE" 2>/dev/null; do
    echo -e "${YELLOW}Waiting for database...${NC}"
    sleep 5
done

echo -e "${GREEN}Database is ready!${NC}"

echo -e "${YELLOW}Step 9: Running database migrations...${NC}"

# Run migrations
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan migrate --force

echo -e "${YELLOW}Step 10: Optimizing Laravel...${NC}"

# Optimize Laravel
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan optimize
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan config:cache
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan route:cache
docker-compose -f "$COMPOSE_FILE" exec -T backend php artisan view:cache

echo -e "${YELLOW}Step 11: Restarting queue worker...${NC}"

# Restart queue worker
docker-compose -f "$COMPOSE_FILE" restart queue

echo -e "${YELLOW}Step 12: Setting up log rotation...${NC}"

# Setup log rotation
sudo tee /etc/logrotate.d/carevance > /dev/null <<EOF
$DEPLOY_DIR/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 root root
}
EOF

echo -e "${YELLOW}Step 13: Cleanup...${NC}"

# Cleanup
rm -f get-docker.sh
docker logout ghcr.io

echo ""
echo -e "${GREEN}=================================${NC}"
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${GREEN}=================================${NC}"
echo ""
echo -e "Your application should now be running at:"
echo -e "${GREEN}http://$(curl -s ifconfig.me)${NC}"
echo ""
echo -e "Check service status with: ${YELLOW}docker-compose -f $COMPOSE_FILE ps${NC}"
echo -e "View logs with: ${YELLOW}docker-compose -f $COMPOSE_FILE logs -f${NC}"
echo ""
echo -e "${YELLOW}Important:${NC}"
echo "1. Make sure your domain DNS is configured to point to this server"
echo "2. Configure SSL/TLS certificates for HTTPS"
echo "3. Set up automated backups for the database"
echo "4. Monitor server resources with: docker stats"
