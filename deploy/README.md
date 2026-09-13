# GitHub deployment

Push to `main` in `kingaki007/pdfpark` to run **Deploy PDF Park**. Other branches do not deploy. You can also run it manually from GitHub Actions.

The workflow builds and tests the frontend, runs backend tests against a disposable PostgreSQL database, then sends the exact checked commit to Oracle. Oracle builds native ARM images before replacing the application containers. Database and document volumes keep the `pdfpark` project name.

Production settings remain in `/home/ubuntu/pdfpark/.env`. GitHub stores only the dedicated SSH deployment key and pinned server host key as Actions secrets (`ORACLE_DEPLOY_KEY`, `ORACLE_KNOWN_HOSTS`). The authorized key is restricted to `/home/ubuntu/bin/pdfpark-deploy`; interactive sessions and forwarding are disabled for it.

Releases and their build logs are in `/home/ubuntu/pdfpark-releases/`. `/home/ubuntu/pdfpark-current` points to the last successful release. Deployments are serialized. A compressed database backup is taken before each rollout in `/home/ubuntu/pdfpark-backups/`. These backups are on the same VM: copy important backups off-server and periodically review disk usage. They do not back up the document volume.

On failed container startup, the script restores previous application image tags. This is an application rollback, not a reversal of database migrations. Review schema changes for backward compatibility before pushing.

To inspect production:

```bash
cd /home/ubuntu/pdfpark-current
sudo docker compose -p pdfpark -f compose.yaml -f release-images.yaml ps
sudo docker compose -p pdfpark -f compose.yaml -f release-images.yaml logs --tail=80 api worker web
```

To change the deployment script, review `deploy/oracle-deploy.sh` and install it on Oracle as `/home/ubuntu/bin/pdfpark-deploy` with mode 700. It is not overwritten automatically by application deployments.

The Oracle network must allow the GitHub runner to connect to SSH port 22. If this is restricted to a home IP, use an approved network path or update the network rules before expecting GitHub-hosted deployment to work.

## Exports

The Export document dropdown supports PDF, JPG, PNG, DOCX, XLSX, PPTX, and Markdown. PNG uses lossless page images; multiple pages download in a ZIP. Markdown uploads the edited PDF to extract text, with page headings and escaped Markdown punctuation. It does not infer original headings, tables, or images; scans require OCR first.