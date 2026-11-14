; Windows installer for Tsuzuku (#108, step 3.2), built by Inno Setup in .github/workflows/app-release.yml:
;   iscc /DAppVersion=X.Y.Z packaging\windows\tsuzuku.iss   (from app/, after flutter build windows --release)
; Per user, no UAC: installs to %LOCALAPPDATA%\Programs\Tsuzuku. The in-app updater (step 3.3) runs it
; with /VERYSILENT /SUPPRESSMSGBOXES /NORESTART.

#ifndef AppVersion
  #error Pass /DAppVersion=X.Y.Z
#endif

[Setup]
; Never changes: it is how a new installer finds and replaces the installed app.
AppId={{765bcb4b-1fd9-49b7-b2cf-823797f10e3d}
AppName=Tsuzuku
AppVersion={#AppVersion}
AppVerName=Tsuzuku {#AppVersion}
AppPublisher=Owais Ahmed
AppPublisherURL=https://github.com/oowais/tsuzuku
VersionInfoVersion={#AppVersion}
PrivilegesRequired=lowest
DefaultDirName={autopf}\Tsuzuku
DisableDirPage=yes
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\build\installer
OutputBaseFilename=tsuzuku-setup
SetupIconFile=..\..\windows\runner\resources\app_icon.ico
UninstallDisplayIcon={app}\tsuzuku.exe
UninstallDisplayName=Tsuzuku
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; Flutter assets of the previous version, so nothing stale stays behind.
Type: filesandordirs; Name: "{app}\data"

[Files]
Source: "..\..\build\windows\x64\runner\Release\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Tsuzuku"; Filename: "{app}\tsuzuku.exe"
Name: "{autodesktop}\Tsuzuku"; Filename: "{app}\tsuzuku.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\tsuzuku.exe"; Description: "{cm:LaunchProgram,Tsuzuku}"; Flags: nowait postinstall skipifsilent
