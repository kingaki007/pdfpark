#!/usr/bin/env bash
set -euo pipefail
umask 077
sha=${SSH_ORIGINAL_COMMAND:-}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a commit SHA'; exit 2; }
exec 9>/home/ubuntu/.pdfpark-deploy.lock
flock -w 1200 9
root=/home/ubuntu/pdfpark-releases
mkdir -p "$root" /home/ubuntu/pdfpark-backups
release=$(mktemp -d "$root/${sha}.XXXXXX")
tar --extract --gzip --no-same-owner --no-same-permissions --directory "$release"
ln -s /home/ubuntu/pdfpark/.env "$release/.env"
cd "$release"
sudo -n docker compose -p pdfpark config --quiet
# Build completely before replacing any running service.
sudo -n docker compose -p pdfpark build > build.log 2>&1 || { tail -n 50 build.log; exit 1; }
# Save exact running image IDs, not the newly built image tags.
for service in web api worker; do
  image=$(sudo -n docker inspect --format '{{.Image}}' "pdfpark-${service}-1")
  sudo -n docker image tag "$image" "pdfpark-${service}:rollback"
done
sudo -n docker exec pdfpark-db-1 pg_dump -U pdfstudio -d pdfstudio | gzip > "/home/ubuntu/pdfpark-backups/${sha}-$(date +%s).sql.gz"
cat > rollback.yaml <<'YAML'
services:
  web:
    image: pdfpark-web:rollback
  api:
    image: pdfpark-api:rollback
  worker:
    image: pdfpark-worker:rollback
YAML
if ! sudo -n docker compose -p pdfpark up -d --no-deps --wait --wait-timeout 180 api worker web; then
  echo 'Startup failed; restoring previous application images.'
  sudo -n docker compose -p pdfpark -f compose.yaml -f rollback.yaml up -d --no-deps --no-build --wait api worker web
  exit 1
fi
curl --fail --retry 5 --retry-delay 3 http://127.0.0.1:8080/api/healthz
ln -sfn "$release" /home/ubuntu/pdfpark-current
printf '\nDeployed %s\n' "$sha"