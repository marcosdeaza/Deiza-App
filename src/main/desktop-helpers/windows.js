// PowerShell source is constant; input JSON is read from stdin (including Unicode text).
module.exports = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $a = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class DeizaDesktop {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Explicit)] public struct Data { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
 [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Data data; }
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback,IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out Rect r,int bytes);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint n,Input[] input,int size);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 public class Window { public string id,name,app; public int pid; public bool active; public Dictionary<string,int> bounds; }
 public static Window[] Windows() {
  var list=new List<Window>(); var active=GetForegroundWindow();
  EnumWindows((h,p)=>{ if(!IsWindowVisible(h)||IsIconic(h))return true; var s=new StringBuilder(1024); GetWindowText(h,s,s.Capacity); if(s.Length==0)return true;
   Rect r; if(DwmGetWindowAttribute(h,9,out r,Marshal.SizeOf(typeof(Rect)))!=0 && !GetWindowRect(h,out r))return true; if(r.Right<=r.Left||r.Bottom<=r.Top)return true; uint pid; GetWindowThreadProcessId(h,out pid); string app=""; try{app=System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;}catch{}
   list.Add(new Window{id="window:"+h.ToInt64()+":0",name=s.ToString(),app=app,pid=(int)pid,active=h==active,bounds=new Dictionary<string,int>{{"x",r.Left},{"y",r.Top},{"width",r.Right-r.Left},{"height",r.Bottom-r.Top}}});return true; },IntPtr.Zero);
  return list.ToArray();
 }
 public static void Key(ushort vk,bool down,bool extended=false) { var i=new Input{type=1}; i.data.keyboard.vk=vk; i.data.keyboard.flags=(down?0u:2u)|(extended?1u:0u); Send(new[]{i}); }
 public static void Chord(ushort vk,ushort[] modifiers,bool extended) { var events=new List<Input>(); foreach(var m in modifiers){var i=new Input{type=1};i.data.keyboard.vk=m;events.Add(i);} var d=new Input{type=1};d.data.keyboard.vk=vk;d.data.keyboard.flags=extended?1u:0u;events.Add(d);var u=d;u.data.keyboard.flags|=2u;events.Add(u);for(int n=modifiers.Length-1;n>=0;n--){var i=new Input{type=1};i.data.keyboard.vk=modifiers[n];i.data.keyboard.flags=2;events.Add(i);}Send(events.ToArray()); }
 public static void Click(uint down,uint up,int count) { var events=new List<Input>();for(int n=0;n<count;n++){var d=new Input{type=0};d.data.mouse.flags=down;events.Add(d);var u=new Input{type=0};u.data.mouse.flags=up;events.Add(u);}Send(events.ToArray()); }
 public static void Text(string text) { var events=new List<Input>(); foreach(char c in text){ var d=new Input{type=1};d.data.keyboard.scan=c;d.data.keyboard.flags=4;var u=d;u.data.keyboard.flags=6;events.Add(d);events.Add(u);}Send(events.ToArray()); }
 public static void MouseEvent(uint flags,int delta=0) {var i=new Input{type=0};i.data.mouse.flags=flags;i.data.mouse.data=unchecked((uint)delta);Send(new[]{i});}
 public static void Send(Input[] events) {if(events.Length>0 && SendInput((uint)events.Length,events,Marshal.SizeOf(typeof(Input)))!=(uint)events.Length) throw new Exception("Windows ha bloqueado la entrada. Las ventanas elevadas necesitan un proceso con los mismos permisos; Deiza no cambia ni elude esa protección.");}
}
'@
  # Work in physical desktop pixels, matching Electron dipToScreenPoint at the boundary.
  try { [void][DeizaDesktop]::SetThreadDpiAwarenessContext([IntPtr](-4)) } catch {}
  if($a.op -eq 'probe') { @{ok=$true;send_input=$true} | ConvertTo-Json -Compress; exit }
  if($a.op -eq 'current') { [uint32]$active=0; [void][DeizaDesktop]::GetWindowThreadProcessId([DeizaDesktop]::GetForegroundWindow(),[ref]$active); @{ok=$true;pid=$active} | ConvertTo-Json -Compress; exit }
  if($a.op -eq 'apps') { @{ok=$true;apps=@([DeizaDesktop]::Windows())} | ConvertTo-Json -Depth 6 -Compress; exit }
  if($a.op -eq 'focus') {
    $matches=@([DeizaDesktop]::Windows() | Where-Object { if($a.window_id){$_.id -eq $a.window_id}else{($_.app -ieq $a.app) -or ($_.name -ieq $a.app) -or ([string]$_.pid -eq $a.app)} })
    if($matches.Count -ne 1) { throw 'No hay una única ventana visible con ese nombre. Usa window_id de desktop_apps.' }
    $w=$matches[0]; $h=[IntPtr]([Int64](($w.id -split ':')[1])); [void][DeizaDesktop]::ShowWindow($h,9)
    [void][DeizaDesktop]::SetForegroundWindow($h); Start-Sleep -Milliseconds 150
    if([DeizaDesktop]::GetForegroundWindow() -ne $h){throw 'Windows no permitió cambiar el foco. Selecciona la ventana y vuelve a intentarlo.'}
    @{ok=$true;pid=$w.pid;name=$w.name;window_id=$w.id} | ConvertTo-Json -Compress; exit
  }
  if($a.target_pid) { [uint32]$active=0; [void][DeizaDesktop]::GetWindowThreadProcessId([DeizaDesktop]::GetForegroundWindow(),[ref]$active); if($active -ne $a.target_pid){throw 'La aplicación activa ha cambiado. Vuelve a seleccionarla con desktop_focus antes de escribir o pulsar.'} }
  switch($a.op) {
    'move' {if(-not [DeizaDesktop]::SetCursorPos($a.x,$a.y)){throw 'Windows no pudo mover el puntero.'}}
    'click' {if(-not [DeizaDesktop]::SetCursorPos($a.x,$a.y)){throw 'Windows no pudo mover el puntero.'};$flags=@{left=@(2,4);right=@(8,16);middle=@(32,64)}[$a.button];[DeizaDesktop]::Click($flags[0],$flags[1],$a.click_count)}
    'drag' {if(-not [DeizaDesktop]::SetCursorPos($a.x,$a.y)){throw 'Windows no pudo mover el puntero.'};[DeizaDesktop]::MouseEvent(2);Start-Sleep -Milliseconds 40;for($i=1;$i -le 10;$i++){$t=$i/10;[void][DeizaDesktop]::SetCursorPos([int]($a.x+($a.x2-$a.x)*$t),[int]($a.y+($a.y2-$a.y)*$t));Start-Sleep -Milliseconds 12};Start-Sleep -Milliseconds 30;[DeizaDesktop]::MouseEvent(4)}
    'type' {[DeizaDesktop]::Text([string]$a.text)}
    'key' {[ushort[]]$mods=@($a.modifiers | ForEach-Object { @{control=17;alt=18;shift=16;meta=91}[$_] });[DeizaDesktop]::Chord($a.key_code,$mods,$a.extended)}
    'scroll' {if($a.delta_y){[DeizaDesktop]::MouseEvent(2048,-[int]$a.delta_y)};if($a.delta_x){[DeizaDesktop]::MouseEvent(4096,[int]$a.delta_x)}}
    default {throw 'Operación de escritorio desconocida.'}
  }
  @{ok=$true} | ConvertTo-Json -Compress
} catch { @{error=$_.Exception.Message} | ConvertTo-Json -Compress; exit 1 }
`;
