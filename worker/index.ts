import handler from 'vinext/server/fetch-handler';
import indexHtml from '../views/index.html?raw';
import adminHtml from '../views/admin.html?raw';
import accountHtml from '../views/account.html?raw';
import {handleApi, uploadedImage} from '../lib/store-api';
import {runWithConnectorBinding} from '../lib/connector-context';
import type {ConnectorBinding} from '../lib/connector-contract.mjs';
const htmlHeaders={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'};
export default {
  fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext<{CONNECTORS?:ConnectorBinding}>) {
    const path=new URL(request.url).pathname;
    if(request.method==='GET'&&path==='/')return new Response(indexHtml,{headers:htmlHeaders});
    if(request.method==='GET'&&path==='/admin')return new Response(adminHtml,{headers:htmlHeaders});
    if(request.method==='GET'&&path==='/account')return new Response(accountHtml,{headers:htmlHeaders});
    if(path.startsWith('/api/'))return handleApi(request,env);
    if(request.method==='GET'&&path.startsWith('/uploads/'))return uploadedImage(request,env);
    let binding=ctx.props?.CONNECTORS;
    if(import.meta.env.DEV&&!binding&&env.CONNECTORS){
      const preview=env.CONNECTORS,expiresAt=Date.now()+60_000;
      binding={async getContext(){return Date.now()<expiresAt?preview.getContext?.()??{status:'binding_unavailable'}:{status:'request_context_expired'};},async invoke(connectorId,actionName,args){return Date.now()<expiresAt?preview.invoke(connectorId,actionName,args):{status:'request_context_expired',message:'This request has expired. Please try again.'};}};
    }
    return runWithConnectorBinding(binding,()=>handler.fetch(request,env,ctx));
  },
};
