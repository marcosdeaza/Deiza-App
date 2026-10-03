/** Desktop tools run in Electron's main process, with explicit per-call consent in the broker.
 * Sources are enumerated without thumbnails. Only the chosen source is streamed for one frame;
 * no microphone, system audio, clipboard access, persistent recording, or background monitor.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { BrowserWindow, desktopCapturer, screen, session, systemPreferences } = require('electron');
const macScript = require('./desktop-helpers/macos');
const winScript = require('./desktop-helpers/windows');

const MAC_KEYS = { A:0,S:1,D:2,F:3,H:4,G:5,Z:6,X:7,C:8,V:9,B:11,Q:12,W:13,E:14,R:15,Y:16,T:17,'1':18,'2':19,'3':20,'4':21,'6':22,'5':23,'=':24,'9':25,'7':26,'-':27,'8':28,'0':29,']':30,O:31,U:32,'[':33,I:34,P:35,Enter:36,L:37,J:38,"'":39,K:40,';':41,'\\':42,',':43,'/':44,N:45,M:46,'.':47,Tab:48,Space:49,'`':50,Backspace:51,Escape:53,F1:122,F2:120,F3:99,F4:118,F5:96,F6:97,F7:98,F8:100,F9:101,F10:109,F11:103,F12:111,F13:105,F14:107,F15:113,F16:106,F17:64,F18:79,F19:80,F20:90,Home:115,PageUp:116,Delete:117,End:119,PageDown:121,ArrowLeft:123,ArrowRight:124,ArrowDown:125,ArrowUp:126 };
const WIN_KEYS = { Enter:13,Tab:9,Space:32,Backspace:8,Escape:27,Home:36,PageUp:33,Delete:46,Insert:45,End:35,PageDown:34,ArrowLeft:37,ArrowRight:39,ArrowDown:40,ArrowUp:38,';':186,'=':187,',':188,'-':189,'.':190,'/':191,'`':192,'[':219,'\\':220,']':221,"'":222 };
const KEY_ALIASES = { esc:'Escape',escape:'Escape',return:'Enter',enter:'Enter',space:'Space',spacebar:'Space',tab:'Tab',backspace:'Backspace',delete:'Delete',del:'Delete',insert:'Insert',home:'Home',end:'End',pageup:'PageUp',pagedown:'PageDown',up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',arrowup:'ArrowUp',arrowdown:'ArrowDown',arrowleft:'ArrowLeft',arrowright:'ArrowRight' };
const MODIFIERS = { ctrl:'control',control:'control',alt:'alt',option:'alt',shift:'shift',cmd:'meta',command:'meta',meta:'meta',super:'meta',win:'meta',windows:'meta' };
const LINUX_KEYS = { Enter:'Return',Space:'space',Backspace:'BackSpace',Escape:'Escape',PageUp:'Prior',PageDown:'Next',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right' };
const abortError = () => Object.assign(new Error('Se canceló el control del ordenador.'), { code:'ABORT_ERR' });
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function boundedNumber(v,name,min,max,def) { const n=v===undefined?def:v; if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max) throw Error(`${name} debe ser un número entre ${min} y ${max}.`); return n; }
function textArg(v,name,max=256) { if(typeof v!=='string'||!v.length||v.length>max||v.includes('\0')) throw Error(`${name} debe ser texto válido de hasta ${max} caracteres.`); return v; }
function parseKey(args, platform) {
  const parts=textArg(args.key,'key',80).split('+');
  const raw=parts.pop();
  const key=KEY_ALIASES[raw.toLowerCase()] || (/^[a-z0-9]$/i.test(raw)?raw.toUpperCase(): /^f(?:[1-9]|1\d|2[0-4])$/i.test(raw)?raw.toUpperCase():raw);
  if(args.modifiers!==undefined&&(!Array.isArray(args.modifiers)||args.modifiers.length>4)) throw Error('modifiers debe ser una lista de hasta cuatro modificadores.');
  const mods=[...parts,...(args.modifiers||[])].map(m=>MODIFIERS[String(m).toLowerCase()]);
  if(mods.some(m=>!m)) throw Error('Usa Ctrl, Alt, Shift o Command/Meta como modificadores.');
  const modifiers=[...new Set(mods)];
  let key_code;
  if(platform==='darwin') key_code=MAC_KEYS[key];
  else if(platform==='win32') key_code=WIN_KEYS[key] ?? (/^[A-Z0-9]$/.test(key)?key.charCodeAt(0):/^F\d+$/.test(key)?111+Number(key.slice(1)):undefined);
  else key_code=key.length===1&&/^[A-Z0-9;,=\-./`\[\]\\']$/.test(key)?key:LINUX_KEYS[key]||(/^(Tab|Delete|Insert|Home|End|F(?:[1-9]|1\d|2[0-4]))$/.test(key)?key:undefined);
  if(key_code===undefined) throw Error('Tecla no admitida. Usa desktop_type para escribir texto o un atajo como Ctrl+L.');
  return {key,modifiers,key_code,extended:/^(Home|End|PageUp|PageDown|Insert|Delete|Arrow)/.test(key)};
}

function runProcess(command, argv, { input='', signal, timeout=15000, env=process.env }={}) {
  checkAbort(signal);
  return new Promise((resolve,reject)=>{
    const child=spawn(command,argv,{stdio:['pipe','pipe','pipe'],windowsHide:true,env,shell:false});
    let stdout='',stderr='',settled=false;
    const finish=(err,out)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);err?reject(err):resolve(out);};
    const stop=(err)=>{child.kill('SIGTERM');finish(err);};
    const abort=()=>stop(abortError());
    const timer=setTimeout(()=>stop(Error('El sistema tardó demasiado en completar el control. Comprueba sus permisos y vuelve a intentarlo.')),timeout);
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',d=>{stdout+=d;if(stdout.length>2*1024*1024)stop(Error('La respuesta del sistema excedió el límite.'));});
    child.stderr.on('data',d=>{if(stderr.length<2000)stderr+=d;});
    child.on('error',e=>finish(Error(e.code==='ENOENT'?'No está disponible la herramienta de control de este sistema.':`No se pudo iniciar el control del sistema (${e.code||'error'}).`)));
    child.on('close',code=>finish(code!==0&&!stdout.trim()?Error('El sistema bloqueó esta operación. Comprueba Accesibilidad o los permisos de la aplicación.'):null,{stdout:stdout.trim(),stderr:stderr.trim(),code}));
    child.stdin.on('error',()=>{});child.stdin.end(input,'utf8');
  });
}

function createDesktopController({ getOwner=()=>null, outputDir, platform=process.platform }={}) {
  const states=new Map();
  let operation=Promise.resolve();
  let linuxTool;
  let stopped=false;
  let captureWindow=null;
  const shutdown=new AbortController();
  const isWayland=()=>platform==='linux'&&(String(process.env.XDG_SESSION_TYPE).toLowerCase()==='wayland'||!!process.env.WAYLAND_DISPLAY);
  function stateFor(ctx) { const id=String(ctx.sessionId||ctx.folder||'default');if(!states.has(id))states.set(id,{});return states.get(id); }
  function native(command,args,ctx={}) {
    const input=JSON.stringify({op:command,...args});
    const exe=platform==='darwin'?'/usr/bin/osascript':path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const argv=platform==='darwin'?['-l','JavaScript','-e',macScript]:['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(winScript,'utf16le').toString('base64')];
    return runProcess(exe,argv,{input,signal:ctx.signal}).then(r=>{
      let data;try{data=JSON.parse(r.stdout);}catch{throw Error('El sistema no devolvió una respuesta válida al controlar la aplicación.');}
      if(data.error)throw Error(data.error);if(!data.ok)throw Error('El sistema no pudo completar la operación.');return data;
    });
  }
  async function xdo(argv,ctx={},input='') {
    if(isWayland())throw Error('La sesión usa Wayland. Deiza puede capturar la fuente elegida con el portal del sistema, pero el control del ratón y teclado no está disponible en esta sesión.');
    if(!process.env.DISPLAY)throw Error('No hay una sesión gráfica X11 para controlar aplicaciones.');
    if(linuxTool===false)throw Error('El control de escritorio en X11 necesita xdotool. No está instalado.');
    const result=await runProcess('xdotool',argv,{signal:ctx.signal,input});
    linuxTool=true;
    if(result.code!==0)throw Error('X11 no pudo completar la operación con xdotool. La ventana puede haber cerrado o denegado el foco.');
    return result.stdout;
  }
  async function current(ctx) { if(platform==='linux')return {pid:Number(await xdo(['getwindowfocus','getwindowpid'],ctx))};return native('current',{},ctx); }
  async function listSources(types,ctx) {
    checkAbort(ctx.signal);
    let timer,abort;
    const interrupted=new Promise((_,reject)=>{
      abort=()=>reject(abortError());ctx.signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>reject(Error('No se pudo listar las fuentes de pantalla a tiempo. Comprueba el selector o permiso del sistema.')),15000);
    });
    try{return await Promise.race([desktopCapturer.getSources({types,thumbnailSize:{width:0,height:0},fetchWindowIcons:false}),interrupted]);}
    finally{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);}
  }
  function sourceMeta(s) { return {id:s.id,name:s.name,type:s.id.startsWith('screen:')?'screen':'window',display_id:s.display_id||null}; }
  async function applications(ctx) {
    const sources=await listSources(['window','screen'],ctx);
    let data={apps:[],windows:[]}, input_error=null;
    if(platform==='linux') {
      if(!isWayland()&&process.env.DISPLAY) {
        try {
          const ids=(await xdo(['search','--onlyvisible','--name','.'],ctx)).split(/\s+/).filter(v=>/^\d+$/.test(v)).slice(0,80);
          for(const id of ids){checkAbort(ctx.signal);let name;try{name=await xdo(['getwindowname',id],ctx);}catch{continue;}data.apps.push({id:`window:${id}:0`,name,window_id:`window:${id}:0`});}
        }catch(e){input_error=e.message;}
      }
    } else data=await native('apps',{},ctx);
    return {apps:data.apps,windows:data.windows||data.apps.filter(a=>a.bounds),sources:sources.map(sourceMeta),displays:screen.getAllDisplays().map(d=>({id:String(d.id),bounds:d.bounds,scale_factor:d.scaleFactor,primary:d.id===screen.getPrimaryDisplay().id})),capabilities:await capabilities(),...(input_error?{input_error}:{})};
  }
  function dipBounds(bounds) {
    if(platform!=='win32'&&platform!=='linux')return bounds;
    const a=screen.screenToDipPoint({x:bounds.x,y:bounds.y});
    const b=screen.screenToDipPoint({x:bounds.x+bounds.width,y:bounds.y+bounds.height});
    return {x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y};
  }
  async function capture(source,maxWidth,ctx,png=false) {
    const partition=`deiza-capture-${crypto.randomBytes(12).toString('hex')}`;
    const ses=session.fromPartition(partition,{cache:false});
    let win;
    const ownUrl=require('url').pathToFileURL(path.join(__dirname,'desktop-helpers/capture.html')).href;
    const allowed=(wc,permission)=>!!win&&!win.isDestroyed()&&wc?.id===win.webContents.id&&['display-capture','media'].includes(permission);
    ses.setPermissionCheckHandler(allowed);
    ses.setPermissionRequestHandler((wc,permission,callback)=>callback(allowed(wc,permission)));
    ses.setDisplayMediaRequestHandler((request,callback)=>{
      if(!win||win.isDestroyed()||request.frame?.url!==ownUrl||request.audioRequested){callback({});return;}
      callback({video:source});
    });
    win=new BrowserWindow({width:1,height:1,show:false,skipTaskbar:true,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    captureWindow=win;
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',e=>e.preventDefault());
    let timer,abort;
    const interrupted=new Promise((_,reject)=>{
      abort=()=>reject(abortError());ctx.signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>reject(Error('No se pudo capturar la fuente a tiempo. Comprueba el permiso de grabación de pantalla y vuelve a intentarlo.')),30000);
    });
    try {
      checkAbort(ctx.signal);
      const task=(async()=>{
        await win.loadFile(path.join(__dirname,'desktop-helpers/capture.html'));
        checkAbort(ctx.signal);
        return win.webContents.executeJavaScript(`(async()=>{
          let stream;
          try {
            stream=await navigator.mediaDevices.getDisplayMedia({audio:false,video:{frameRate:1}});
            const video=document.createElement('video');video.muted=true;video.srcObject=stream;
            await video.play();await new Promise(resolve=>video.requestVideoFrameCallback(resolve));
            const ratio=Math.min(1,${maxWidth}/video.videoWidth);
            const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*ratio));canvas.height=Math.max(1,Math.round(video.videoHeight*ratio));
            canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
            return {data_url:canvas.toDataURL(${png?"'image/png'":"'image/jpeg',0.8"}),mime_type:${png?"'image/png'":"'image/jpeg'"},width:canvas.width,height:canvas.height,native_width:video.videoWidth,native_height:video.videoHeight};
          } finally {if(stream)stream.getTracks().forEach(track=>track.stop());}
        })()`,true);
      })();
      return await Promise.race([task,interrupted]);
    } catch(e) {
      if(e.code==='ABORT_ERR')throw e;
      if(/notallowed|permission denied|permission dismissed|could not start|not readable/i.test(e.message))throw Error('El sistema no permitió capturar esta fuente. Autoriza la grabación de pantalla de Deiza en los ajustes de privacidad y vuelve a intentarlo.');
      throw e;
    } finally {
      clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);
      if(!win.isDestroyed())win.destroy();if(captureWindow===win)captureWindow=null;
      ses.setDisplayMediaRequestHandler(null);ses.setPermissionRequestHandler(null);ses.setPermissionCheckHandler(null);
    }
  }
  async function saveScreenshot(relative,data,ctx) {
    if(!ctx.folder&&!outputDir)throw Error('Selecciona una carpeta de proyecto para guardar la captura.');
    const root=fs.realpathSync(ctx.folder||outputDir||'');
    const rel=textArg(relative,'path',1024);
    if(path.isAbsolute(rel)||path.win32.isAbsolute(rel)||rel.split(/[\\/]+/).some(p=>p==='..')||!rel.toLowerCase().endsWith('.png'))throw Error('path debe ser un archivo .png relativo dentro de la carpeta del proyecto.');
    const parts=rel.split(/[\\/]+/).filter(Boolean);let dir=root;
    for(const part of parts.slice(0,-1)){dir=path.join(dir,part);try{const stat=fs.lstatSync(dir);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('La ruta de captura no puede atravesar enlaces simbólicos ni archivos.');}catch(e){if(e.code!=='ENOENT')throw e;fs.mkdirSync(dir,{mode:0o700});}}
    checkAbort(ctx.signal);
    const target=path.join(dir,parts.at(-1));
    try{fs.writeFileSync(target,Buffer.from(data.split(',')[1],'base64'),{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')throw Error('La captura ya existe. Elige otro nombre para guardarla.');throw e;}
    return target;
  }
  async function screenshot(args,ctx,state) {
    const maxWidth=Math.round(boundedNumber(args.max_width,'max_width',320,3840,1280));
    const sourceId=args.source_id===undefined?null:textArg(args.source_id,'source_id');
    const displayId=args.display_id===undefined?null:String(args.display_id);
    if(platform==='darwin'&&systemPreferences.getMediaAccessStatus('screen')==='denied')throw Error('Deiza no tiene permiso de grabación de pantalla. Autorízalo en Ajustes del Sistema → Privacidad y seguridad → Grabación de pantalla.');
    const sources=await listSources(sourceId?.startsWith('window:')?['window']:['screen'],ctx);
    const primary=String(screen.getPrimaryDisplay().id);
    const source=sourceId?sources.find(s=>s.id===sourceId):sources.find(s=>s.display_id===(displayId||primary))||(!displayId&&sources.length===1?sources[0]:null);
    if(!source)throw Error('No se encontró la pantalla o ventana seleccionada. Usa desktop_apps para elegir una fuente visible.');
    let bounds,pid;
    if(source.id.startsWith('window:')) {
      if(isWayland()) {
        // PipeWire returns the user-selected portal source, without global window geometry.
        // Keep capture available; native desktop input remains explicitly unsupported.
      } else if(platform==='linux') {
        const id=source.id.split(':')[1];if(!/^\d+$/.test(id))throw Error('El portal de esta sesión no ofrece coordenadas de esa ventana. Selecciona una pantalla.');
        const geometry=await xdo(['getwindowgeometry','--shell',id],ctx);
        const get=k=>Number(new RegExp(`(?:^|\\n)${k}=(-?\\d+)`).exec(geometry)?.[1]);
        bounds=dipBounds({x:get('X'),y:get('Y'),width:get('WIDTH'),height:get('HEIGHT')});pid=Number(await xdo(['getwindowpid',id],ctx));
      } else {
        const listing=await native('apps',{},ctx);const w=(listing.windows||listing.apps).find(w=>w.id===source.id);
        if(!w)throw Error('La ventana seleccionada ya no está visible. Vuelve a elegirla con desktop_apps.');bounds=dipBounds(w.bounds);pid=w.pid;
      }
    } else {
      const display=screen.getAllDisplays().find(d=>String(d.id)===source.display_id);
      if(display)bounds=display.bounds;
    }
    const wantPng=!!(ctx.png||args.path);
    const pidTask=!source.id.startsWith('window:')&&!isWayland()?current(ctx).then(r=>r.pid,()=>undefined):null;
    const image=await capture(source,maxWidth,ctx,wantPng);
    if(pidTask)pid=await pidTask;
    checkAbort(ctx.signal);
    if(!image.width||!image.height||image.data_url.length>20*1024*1024)throw Error('La captura excede el tamaño disponible. Reduce max_width e inténtalo de nuevo.');
    if(platform==='darwin'&&source.id.startsWith('window:')&&bounds) {
      // CGWindow's frame includes the one-point outer outline; ScreenCaptureKit's frame does not.
      // Correct only this small symmetric difference, using the frame's native (unscaled) dimensions.
      const factor=screen.getDisplayMatching(bounds).scaleFactor;
      const w=image.native_width/factor,h=image.native_height/factor;
      const dx=bounds.width-w,dy=bounds.height-h;
      if(dx>=0&&dx<=4&&dy>=0&&dy<=4)bounds={x:bounds.x+dx/2,y:bounds.y+dy/2,width:w,height:h};
    }
    const scale=bounds?{x:bounds.width/image.width,y:bounds.height/image.height}:null;
    state.capture={source_id:source.id,display_id:source.display_id||null,bounds,width:image.width,height:image.height,scale,max_width:maxWidth,at:Date.now()};
    state.pid=pid||null;
    const result={...image,source_id:source.id,display_id:source.display_id||null,bounds:bounds||null,coordinate_scale:scale,coordinate_space:'screenshot_pixels',coordinate_hint:scale?'desktop_click x,y usa píxeles de esta captura; Deiza los convierte a puntos globales de pantalla.':'El portal no devuelve coordenadas globales; el control de esta captura no está disponible.'};
    if(args.path)result.path=await saveScreenshot(args.path,image.data_url,ctx);
    return result;
  }
  async function capabilities() {
    const mac=platform==='darwin',linux=platform==='linux';
    let screen_permission='unknown',accessibility_permission='not-required';
    if(mac){screen_permission=systemPreferences.getMediaAccessStatus('screen');accessibility_permission=systemPreferences.isTrustedAccessibilityClient(false)?'granted':'not-granted';}
    let input_supported=platform==='win32'||mac,input_reason=null;
    if(linux){input_supported=!isWayland()&&!!process.env.DISPLAY;if(input_supported&&linuxTool===undefined){try{const p=await runProcess('xdotool',['--version'],{timeout:3000});linuxTool=p.code===0;}catch{linuxTool=false;}}input_supported=input_supported&&linuxTool===true;input_reason=isWayland()?'Control de escritorio no disponible en Wayland.':!process.env.DISPLAY?'No hay sesión gráfica X11.':!linuxTool?'Se necesita xdotool en X11.':null;}
    if(!['darwin','win32','linux'].includes(platform))input_reason='Sistema no admitido para controlar aplicaciones.';
    return {platform,screenshot:true,input:input_supported,screen_permission,accessibility_permission,...(input_reason?{input_reason}:{}),audio:false,background_monitoring:false};
  }
  function mapPoint(x,y,args,state) {
    x=boundedNumber(x,'x',-100000,100000);y=boundedNumber(y,'y',-100000,100000);
    const space=args.coordinate_space||'screenshot';if(!['screen','screenshot'].includes(space))throw Error('coordinate_space debe ser screenshot o screen.');
    if(space==='screenshot') {const c=state.capture;if(!c?.bounds||!c.scale)throw Error('Toma una captura de la fuente seleccionada antes de mover el ratón o clicar.');if(Date.now()-c.at>120000)throw Error('La captura ha caducado. Toma otra para clicar con coordenadas actuales.');if(args.source_id&&args.source_id!==c.source_id||args.display_id!==undefined&&String(args.display_id)!==c.display_id)throw Error('Las coordenadas corresponden a otra fuente. Toma una captura de la seleccionada.');if(x<0||x>=c.width||y<0||y>=c.height)throw Error('El punto debe estar dentro de la captura.');x=c.bounds.x+x*c.scale.x;y=c.bounds.y+y*c.scale.y;}
    if(!screen.getAllDisplays().some(d=>x>=d.bounds.x&&y>=d.bounds.y&&x<d.bounds.x+d.bounds.width&&y<d.bounds.y+d.bounds.height))throw Error('El punto está fuera de las pantallas visibles.');
    if(platform==='win32'||platform==='linux')({x,y}=screen.dipToScreenPoint({x:Math.round(x),y:Math.round(y)}));
    return {x:Math.round(x),y:Math.round(y)};
  }
  // Act and look in one call: a fresh capture of the same surface saves a whole model round trip.
  async function observe(args,ctx,state,result,prev) {
    if(args.observe===false)return result;
    const c=prev||state.capture;
    const ms=Math.round(boundedNumber(args.settle_ms,'settle_ms',0,3000,250));
    if(ms){await new Promise(r=>setTimeout(r,ms));}
    checkAbort(ctx.signal);
    try {
      const shot=await screenshot(c?{source_id:c.source_id,max_width:c.max_width}:{},{...ctx,png:false},state);
      return {...result,...shot,message:'Acción hecha. La captura adjunta muestra el estado actual; sus coordenadas valen para las siguientes acciones.'};
    } catch(e) { if(e.code==='ABORT_ERR')throw e; return {...result,observe_error:String(e.message||e).slice(0,300)}; }
  }
  async function perform(name,args,ctx) {
    if(stopped)throw Error('El control del ordenador se ha cerrado.');checkAbort(ctx.signal);
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Los argumentos de escritorio deben ser un objeto.');
    const state=stateFor(ctx);
    if(name==='desktop_apps')return applications(ctx);
    if(name==='desktop_screenshot')return screenshot(args,ctx,state);
    if(name==='desktop_focus') {
      const app=args.app===undefined?null:textArg(args.app,'app');const windowId=args.window_id===undefined?null:textArg(args.window_id,'window_id');
      if(!app&&!windowId)throw Error('Elige app o window_id de desktop_apps.');
      let result;
      if(platform==='linux') {let id=windowId?.match(/^window:(\d+):\d+$/)?.[1];if(!id){const ids=(await xdo(['search','--onlyvisible','--name',`^${app.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`],ctx)).split(/\s+/).filter(Boolean);if(ids.length!==1)throw Error('Usa window_id para elegir una ventana visible de forma inequívoca.');id=ids[0];}await xdo(['windowactivate','--sync',id],ctx);result={ok:true,pid:Number(await xdo(['getwindowpid',id],ctx)),window_id:`window:${id}:0`};}
      else result=await native('focus',{app,window_id:windowId},ctx);
      state.pid=result.pid;state.capture=null;return result;
    }
    if(!['desktop_click','desktop_drag','desktop_mouse_move','desktop_type','desktop_key','desktop_scroll'].includes(name))throw Error('Herramienta de escritorio desconocida.');
    if(!state.pid)throw Error('Selecciona una aplicación con desktop_focus o toma una captura antes de controlarla.');
    if(platform==='darwin'&&!systemPreferences.isTrustedAccessibilityClient(true))throw Error('Deiza necesita permiso de Accesibilidad. Autorízalo en Ajustes del Sistema → Privacidad y seguridad → Accesibilidad y vuelve a intentarlo.');
    const a={target_pid:state.pid};
    if(name==='desktop_click'||name==='desktop_mouse_move') {
      Object.assign(a,mapPoint(args.x,args.y,args,state),{button:args.button||'left',click_count:boundedNumber(args.click_count,'click_count',1,2,1)});
      if(!['left','right','middle'].includes(a.button)||!Number.isInteger(a.click_count))throw Error('Usa left, right o middle y click_count 1 o 2.');
    } else if(name==='desktop_drag') {
      const from=mapPoint(args.from_x,args.from_y,args,state),to=mapPoint(args.to_x,args.to_y,args,state);
      Object.assign(a,{x:from.x,y:from.y,x2:to.x,y2:to.y});
    } else if(name==='desktop_type')a.text=textArg(args.text,'text',16000);
    else if(name==='desktop_key')Object.assign(a,parseKey(args,platform));
    else Object.assign(a,{delta_y:Math.round(boundedNumber(args.delta_y,'delta_y',-4000,4000,0)),delta_x:Math.round(boundedNumber(args.delta_x,'delta_x',-4000,4000,0))});
    const op=name==='desktop_mouse_move'?'move':name.slice('desktop_'.length);
    if(platform==='linux') {
      const active=await current(ctx);if(active.pid!==a.target_pid)throw Error('La aplicación activa ha cambiado. Vuelve a seleccionarla con desktop_focus.');
      if(op==='click')await xdo(['mousemove','--sync',String(a.x),String(a.y),'click','--repeat',String(a.click_count),'--delay','70',String({left:1,middle:2,right:3}[a.button])],ctx);
      else if(op==='move')await xdo(['mousemove','--sync',String(a.x),String(a.y)],ctx);
      else if(op==='drag')await xdo(['mousemove','--sync',String(a.x),String(a.y),'mousedown','1','sleep','0.05','mousemove','--sync',String(Math.round((a.x+a.x2)/2)),String(Math.round((a.y+a.y2)/2)),'sleep','0.03','mousemove','--sync',String(a.x2),String(a.y2),'sleep','0.05','mouseup','1'],ctx);
      else if(op==='type')await xdo(['type','--clearmodifiers','--delay','0','--file','-'],ctx,a.text);
      else if(op==='key')await xdo(['key','--clearmodifiers',[...a.modifiers.map(m=>({control:'ctrl',alt:'alt',shift:'shift',meta:'super'}[m])),a.key_code].join('+')],ctx);
      else {for(const [delta,buttons]of [[a.delta_y,[4,5]],[a.delta_x,[6,7]]])if(delta)await xdo(['click','--repeat',String(Math.min(40,Math.max(1,Math.round(Math.abs(delta)/100)))),'--delay','20',String(buttons[delta>0?1:0])],ctx);}
    } else await native(op,a,ctx);
    // Clicks, drags, keys and typing do not move the surface, so the capture's coordinates stay
    // valid for the next action (two clicks to move a piece). Scrolling does move it.
    const prev=state.capture;
    if(op==='scroll')state.capture=null;
    const done={ok:true,...(op==='type'?{characters:a.text.length}:op==='click'||op==='move'?{x:a.x,y:a.y}:{}),message:op==='move'?'Puntero movido al punto.':'Operación completada.'};
    if(op==='move')return done;
    return observe(args,ctx,state,done,prev);
  }
  return {
    capabilities,
    execute(name,args={},ctx={}) {const active={...ctx,signal:ctx.signal?AbortSignal.any([ctx.signal,shutdown.signal]):shutdown.signal};const task=operation.catch(()=>{}).then(()=>perform(name,args,active));operation=task;return task;},
    forget(sessionId) {states.delete(String(sessionId));},
    dispose() {stopped=true;shutdown.abort();states.clear();if(captureWindow&&!captureWindow.isDestroyed())captureWindow.destroy();},
  };
}

module.exports={createDesktopController};
