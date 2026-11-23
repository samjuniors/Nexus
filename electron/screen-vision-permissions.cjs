'use strict';

/**
 * Electron getDisplayMedia source picker. A desktop permission is never an
 * unattended capture grant; every Start Screen Vision action triggers an
 * explicit native screen/window selection dialog, and no audio is captured.
 */
function safeOrigin(value){try{return new URL(value).origin;}catch{return null;}}

function configureScreenVision({targetSession,getWindow,desktopCapturer,dialog,origin,denyMedia=false}){
  let pending=false;
  targetSession.setDisplayMediaRequestHandler(async(request,callback)=>{
    const win=getWindow();
    const frame=request?.frame;
    const trusted=win&&!win.isDestroyed()&&frame===win.webContents.mainFrame&&
      typeof frame.url==='string'&&safeOrigin(frame.url)===origin;
    if(!trusted||denyMedia||pending){callback(null);return;}
    pending=true;
    try{
      const sources=await desktopCapturer.getSources({
        types:['window','screen'],thumbnailSize:{width:0,height:0},
      });
      const eligible=sources.filter(source=>source&&
        typeof source.name==='string'&&source.name.trim()&&
        /^(?:screen:|window:)/.test(source.id)).slice(0,15);
      if(!eligible.length){callback(null);return;}
      const buttons=['Cancel',...eligible.map((source,index)=>
        (source.id.startsWith('screen:')?'Screen · ':'Window · ')+source.name.slice(0,67))];
      const response=await dialog.showMessageBox(win,{
        type:'question',title:'Eva Screen Vision — choose a source',
        message:'Which screen or application may Eva see?',
        detail:'This sends sampled screen images to your active Gemini Live provider while sharing is on. Passwords, chats and notifications visible in your selection may be included. No keyboard or mouse control is granted. Stop sharing at any time from Eva.',
        buttons,defaultId:0,cancelId:0,noLink:true,
      });
      if(response.response===0||win.isDestroyed()||frame!==win.webContents.mainFrame){
        callback(null);return;
      }
      const selected=eligible[response.response-1];
      callback(selected?{video:selected}:null);
    }catch{callback(null);}
    finally{pending=false;}
  },{useSystemPicker:false});
}

module.exports={configureScreenVision};
