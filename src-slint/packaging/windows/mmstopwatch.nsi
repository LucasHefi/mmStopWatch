Unicode true
!ifndef VERSION
  !error "VERSION must be provided with /DVERSION=<version>"
!endif
Name "mmStopWatch Native"
OutFile "mmStopWatch-Native-${VERSION}-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\mmStopWatch Native"
RequestExecutionLevel user
Icon "..\..\assets\icons\icon.ico"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /oname=mmstopwatch.exe "..\..\target\release\mmstopwatch-slint.exe"
  CreateShortcut "$DESKTOP\mmStopWatch Native.lnk" "$INSTDIR\mmstopwatch.exe"
  CreateDirectory "$SMPROGRAMS\mmStopWatch Native"
  CreateShortcut "$SMPROGRAMS\mmStopWatch Native\mmStopWatch Native.lnk" "$INSTDIR\mmstopwatch.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\mmStopWatchNative" "DisplayName" "mmStopWatch Native"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\mmStopWatchNative" "UninstallString" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\mmStopWatch Native.lnk"
  Delete "$SMPROGRAMS\mmStopWatch Native\mmStopWatch Native.lnk"
  RMDir "$SMPROGRAMS\mmStopWatch Native"
  Delete "$INSTDIR\mmstopwatch.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\mmStopWatchNative"
SectionEnd
