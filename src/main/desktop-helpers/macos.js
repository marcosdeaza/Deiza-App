// Static JXA program. User arguments arrive on stdin as JSON, never as executable source.
module.exports = String.raw`
ObjC.import('Cocoa');
ObjC.import('ApplicationServices');
function run() {
  try {
    const bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    const a = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
    if (a.op === 'probe') return JSON.stringify({ok:true, trusted:!!$.AXIsProcessTrusted(), core_graphics:typeof $.CGEventCreateMouseEvent === 'function'});
    const workspace = $.NSWorkspace.sharedWorkspace;
    if (a.op === 'current') return JSON.stringify({ok:true,pid:Number(workspace.frontmostApplication.processIdentifier)});
    if (a.op === 'apps') {
      const list = workspace.runningApplications;
      const apps = [];
      for (let i=0; i<list.count; i++) {
        const p=list.objectAtIndex(i);
        if (Number(p.activationPolicy) !== 0 || p.terminated) continue;
        apps.push({id:String(p.processIdentifier),pid:Number(p.processIdentifier),name:ObjC.unwrap(p.localizedName)||'',bundle_id:ObjC.unwrap(p.bundleIdentifier)||'',active:!!p.active});
      }
      return JSON.stringify({ok:true,apps:apps,windows:windows()});
    }
    if (a.op === 'focus') {
      let pid=0, title='';
      if (a.window_id) {
        const w=windows().find(w=>w.id===a.window_id);
        if (!w) throw Error('La ventana seleccionada ya no está visible.');
        pid=w.pid; title=w.name;
      }
      const list=workspace.runningApplications;
      const matching=[];
      for (let i=0;i<list.count;i++) {
        const p=list.objectAtIndex(i);
        if (p.terminated || Number(p.activationPolicy)!==0) continue;
        const name=ObjC.unwrap(p.localizedName)||'', bundle=ObjC.unwrap(p.bundleIdentifier)||'';
        if ((pid && Number(p.processIdentifier)===pid) || (!pid && [name,bundle,String(p.processIdentifier)].some(v=>v.toLowerCase()===a.app.toLowerCase()))) matching.push(p);
      }
      if (matching.length!==1) throw Error(matching.length ? 'Hay varias aplicaciones con ese nombre; usa su identificador.' : 'La aplicación no está abierta. Selecciónala con desktop_apps.');
      const p=matching[0];
      if (!p.activateWithOptions($.NSApplicationActivateIgnoringOtherApps)) throw Error('macOS no pudo traer la aplicación al frente.');
      $.NSThread.sleepForTimeInterval(0.18);
      if (a.window_id && title) {
        // Exact window focus also uses the system accessibility scripting interface.
        const se=Application('System Events');
        const proc=se.processes.whose({unixId:Number(p.processIdentifier)})[0];
        const win=proc.windows.whose({name:title})();
        if (win.length!==1) throw Error('No se puede identificar esa ventana de forma inequívoca. Usa el nombre de la aplicación y comprueba una captura.');
        win[0].actions.byName('AXRaise').perform();
      }
      return JSON.stringify({ok:true,pid:Number(p.processIdentifier),name:ObjC.unwrap(p.localizedName)||'',window_id:a.window_id||null});
    }
    if (!$.AXIsProcessTrusted()) throw Error('Deiza necesita permiso de Accesibilidad en Ajustes del Sistema → Privacidad y seguridad para controlar esta aplicación.');
    if (a.target_pid && Number(workspace.frontmostApplication.processIdentifier)!==a.target_pid) throw Error('La aplicación activa ha cambiado. Vuelve a seleccionarla con desktop_focus antes de escribir o pulsar.');
    if (a.op==='move') {
      const point=$.CGPointMake(a.x,a.y);
      const m=$.CGEventCreateMouseEvent(null,5,point,0);
      $.CGEventPost(0,m);
    } else if (a.op==='click') {
      const point=$.CGPointMake(a.x,a.y), button={left:0,right:1,middle:2}[a.button];
      const down=[1,3,25][button],up=[2,4,26][button];
      for (let i=1;i<=a.click_count;i++) {
        const d=$.CGEventCreateMouseEvent(null,down,point,button), u=$.CGEventCreateMouseEvent(null,up,point,button);
        $.CGEventSetIntegerValueField(d,1,i); $.CGEventSetIntegerValueField(u,1,i);
        $.CGEventPost(0,d); $.NSThread.sleepForTimeInterval(0.025); $.CGEventPost(0,u);
        $.NSThread.sleepForTimeInterval(0.045);
      }
    } else if (a.op==='type') {
      // System Events accepts Unicode directly, without replacing the user's clipboard.
      Application('System Events').keystroke(a.text);
    } else if (a.op==='key') {
      const flags=a.modifiers.reduce((f,m)=>f+({shift:131072,control:262144,alt:524288,meta:1048576}[m]||0),0);
      const d=$.CGEventCreateKeyboardEvent(null,a.key_code,true), u=$.CGEventCreateKeyboardEvent(null,a.key_code,false);
      $.CGEventSetFlags(d,flags); $.CGEventSetFlags(u,flags); $.CGEventPost(0,d); $.CGEventPost(0,u);
    } else if (a.op==='scroll') {
      // JXA's native framework metadata preserves CGEventRef for this variadic function.
      const e=$.CGEventCreateScrollWheelEvent(null,0,2,-a.delta_y,-a.delta_x,0); $.CGEventPost(0,e);
    } else throw Error('Operación de escritorio desconocida.');
    return JSON.stringify({ok:true});
  } catch(e) {
    const message=String(e.message||e);
    return JSON.stringify({error:/not authorized|not allowed|privilege|assistive|(-1743)|(-1719)/i.test(message) ? 'macOS necesita autorizar Deiza en Accesibilidad y, para escribir texto o seleccionar ventanas, Automatización → System Events. Actívalo en Ajustes del Sistema → Privacidad y seguridad y vuelve a intentarlo.' : message});
  }
}
function windows() {
  // CFArrayRef is otherwise exposed as an opaque Ref by the JXA bridge. NSArray is toll-free bridged.
  ObjC.bindFunction('CGWindowListCopyWindowInfo',['id',['uint32_t','uint32_t']]);
  const values=ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(17,0))||[];
  return values.filter(w=>w.kCGWindowLayer===0&&w.kCGWindowIsOnscreen&&w.kCGWindowBounds&&w.kCGWindowBounds.Width>0&&w.kCGWindowBounds.Height>0).map(w=>({id:'window:'+w.kCGWindowNumber+':0',pid:w.kCGWindowOwnerPID,name:w.kCGWindowName||'',app:w.kCGWindowOwnerName||'',bounds:{x:w.kCGWindowBounds.X,y:w.kCGWindowBounds.Y,width:w.kCGWindowBounds.Width,height:w.kCGWindowBounds.Height}}));
}
`;
