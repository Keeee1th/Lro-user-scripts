' diag-collect center service launcher (hidden window)
' use: scheduled task autostart / double-click manual start
' note: node runs hidden in background, closing console will not stop it
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Program Files\nodejs\node.exe"" ""D:\0_Harness\1_RObot\Lro-user-scripts\tools\diag-collect-server.js""", 0, False
