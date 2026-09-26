# Example custom scripts

Ready-made scripts you can reference from your updater config's `scripts` array.
They are **examples, not code** — the app never imports them; you point your
config at them (or copy them to your own location and edit freely).

## `store-update.ps1` — trigger Microsoft Store app updates

Windows exposes **no supported CLI to list pending Store (MSIX/Appx) app
updates**, so this is a **fire-and-forget trigger**: it asks Windows to scan for
and install Store updates in the background, then returns. It cannot show
progress or list packages — open **Store → Library → "Get updates"** to watch it.

It uses mechanisms verified to exist on Windows 11:

- `rundll32 AppxDeploymentClient.dll,ScheduleAppInstallerBackgroundUpdate`
  (the Appx/app-installer background update)
- the `InstallService` scheduled tasks `ScanForUpdates` / `ScanForUpdatesAsUser`
- the MDM update-scan method, when accessible (usually needs admin; optional)

`ScanForUpdates` normally needs elevation and is skipped with a note when it
fails — that is expected, not an error.

### Wiring it up

`.ps1` files generally have no Windows file association, so the updater cannot
run them directly. Give it an **interpreter** — that also pins the PowerShell
version you want:

```json
{
  "scripts": [
    {
      "name": "StoreUpdates",
      "path": "C:\\path\\to\\store-update.ps1",
      "interpreter": "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
    }
  ]
}
```

Add this to your config (`%USERPROFILE%\.config\updater\config.json`), and a
`StoreUpdates` row appears under **Custom scripts**.

> Note: this configuration is shared with the OpenTUI app `updater-tui`, if you
> use it — one entry shows up in both.
