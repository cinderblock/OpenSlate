OpenSlate in a window of its own, for Windows, macOS and Linux. It's the same app as
[openslate.us](https://openslate.us): your keys, picks and notes stay on your computer.

**Alpha.** Written by AI with a human watching over it: things might be wrong, change, or
break. Check what matters against your official voter guide.

## Which file?

Two editions of each:

- **OpenSlate** reads the public endorsements catalog live, like the website.
- **OpenSlate-Offline** carries a copy of the catalog (every organization's endorsements and
  the official voter guides, as of this release), so you can plan your ballot with no
  internet at all. Polls, forecasts and results still need a connection.

| System | File |
| --- | --- |
| Windows (64-bit) | `OpenSlate-…-windows-x64-Setup.zip` |
| Mac (Apple Silicon) | `OpenSlate-…-macos-arm64.dmg` |
| Linux (64-bit, Ubuntu 24.04 or newer) | `OpenSlate-…-linux-x64-Setup.tar.gz` |

## Installing

These builds aren't code-signed yet, so your system will warn you.

- **Windows:** unzip, then run the `Setup.exe` inside (keep the `.installer` folder next to
  it). When SmartScreen stops it: *More info → Run anyway*. It installs for you alone, no
  admin needed.
- **Mac:** open the `.dmg` and drag OpenSlate to Applications, then start it from
  Applications. If macOS says it's damaged, run `xattr -cr "/Applications/OpenSlate.app"`
  in Terminal (`"/Applications/OpenSlate Offline.app"` for that edition) and open it again.
- **Linux:** extract the archive and run `installer`. Needs `libwebkit2gtk-4.1-0`.

**Updates:** the app updates itself. It checks for a new version now and then, downloads it,
checks it's signed by OpenSlate's release key, and then offers *Restart to update*.

**Before uninstalling:** *App and Data* deletes your signing keys too. Download a backup of any
identity you want to keep first (Publish → Identities).

`SHA256SUMS.txt` lists each file's checksum. Source: this release's tag, built by
[GitHub Actions](https://github.com/cinderblock/openslate/actions/workflows/desktop.yml).
