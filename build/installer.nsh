!macro customInit
  ; Keep the original desktop shortcut and installation path across branding updates.
  !insertmacro GetDParameter $R0
  ${If} $R0 == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Xiaoyu"
  ${EndIf}
!macroend
