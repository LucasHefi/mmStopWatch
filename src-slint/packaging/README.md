# Native release packaging

Linux packages are built with `packaging/linux/package-deb.sh`. The script creates a user-installable `.deb` plus its SHA-256 checksum under `target/packages` and never modifies the source tree.

Windows packages use the NSIS definition in `packaging/windows/mmstopwatch.nsi`. Build the release binary first, then run `makensis /DVERSION=<version> packaging/windows/mmstopwatch.nsi` from the `src-slint` directory.

The release workflow builds and tests both platforms, emits checksums, and uploads artifacts for tags matching `slint-v*`. Publishing `latest.json` and its signed platform entries remains a release-server operation; the application deliberately rejects HTML, malformed metadata, unsigned artifacts, and older versions.
