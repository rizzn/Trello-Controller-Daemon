Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
runnerPath = fso.BuildPath(scriptDir, "global_runner.js")
shell.Run "node """ & runnerPath & """", 0, True
