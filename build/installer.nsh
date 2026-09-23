; Deiza — custom pages for the NSIS assisted installer (UTF-8 with BOM: makensis needs it for accents)

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Te damos la bienvenida a Deiza"
  !define MUI_WELCOMEPAGE_TEXT "Vas a instalar Deiza para escritorio: el workspace y Deiza Code en una sola app.$\r$\n$\r$\nTarda menos de un minuto. Pulsa Siguiente para continuar."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Desinstalar Deiza"
  !define MUI_WELCOMEPAGE_TEXT "Se quitará Deiza de este equipo.$\r$\n$\r$\nTus conversaciones siguen en tu cuenta de deiza.org y los proyectos de Code no se tocan."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_TITLE "Deiza está listo"
  !define MUI_FINISHPAGE_TEXT "Ya puedes abrir Deiza desde el escritorio o el menú Inicio.$\r$\n$\r$\nInicia sesión con tu cuenta y tendrás el chat y Code en la misma ventana."
  !define MUI_FINISHPAGE_RUN_TEXT "Abrir Deiza ahora"
!endif
