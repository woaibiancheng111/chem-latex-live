# Deploy an update

Push reviewed changes to `main`, then run on the server as the deployment user:

```sh
cd ~/deploy/chem-latex-live
git pull --ff-only origin main
bash deploy/release.sh
```

The script exports the current commit, reuses the existing Python environment,
Tectonic installation and MolVec JAR, restarts only ChemLaTeX Live, and rolls
back if the local health check fails. It keeps the previous app path and prints
the deployed commit. Nginx and HTTPS configuration are not installed by this
script. This is an update procedure for the existing server, not a fresh-server
installer.
