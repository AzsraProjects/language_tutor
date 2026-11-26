; Inno Setup script of the Language Tutor desktop app.
; Per-user install (no administrator rights needed), also used for updates.
;   ISCC /DAppVersion=1.0.0 packaging\windows\installer.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6F0B1C1E-7C0B-4E0B-9B3B-2B7C3D1A9E41}
AppName=Language Tutor
AppVersion={#AppVersion}
AppPublisher=Language Tutor
DefaultDirName={localappdata}\Programs\LanguageTutor
DefaultGroupName=Language Tutor
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=LanguageTutor-Setup-{#AppVersion}
SetupIconFile=..\icon.ico
UninstallDisplayIcon={app}\LanguageTutor.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; Remove the previous version's files so an update never mixes two versions.
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\..\dist\LanguageTutor\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Language Tutor"; Filename: "{app}\LanguageTutor.exe"
Name: "{autodesktop}\Language Tutor"; Filename: "{app}\LanguageTutor.exe"; Tasks: desktopicon

[Run]
; No "skipifsilent": a silent in-app update must relaunch the app.
Filename: "{app}\LanguageTutor.exe"; Description: "{cm:LaunchProgram,Language Tutor}"; Flags: nowait postinstall
