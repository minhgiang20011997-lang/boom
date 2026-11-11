/* Online rooms for the standalone site: browsers connect directly to each other (WebRTC through PeerJS).
   The first browser to open a room code becomes the hub and relays everyone's state. */
(function(){
  if(window.claude&&window.claude.use) return;
  if(typeof Peer==='undefined') return;
  const PRE='bongnuoc-dc-';
  function join(name){
    return new Promise((resolve,reject)=>{
      const myId=Math.random().toString(36).slice(2,12);
      const peers=new Map(), hs=new Set(), conns=new Map();
      let mine={}, cur=Object.freeze([]), left=false, peer=null, up=null, settled=false;
      const fire=()=>{ cur=Object.freeze([...peers.values()]); hs.forEach(h=>{ try{ h({peers:cur,joined:[],left:[],updated:[]}) }catch(e){} }); };
      const setPeer=(id,pres)=>peers.set(id,Object.freeze({peer:id,by:null,isMe:id===myId,sameTab:id===myId,kind:'viewer',guest:false,presence:Object.freeze(pres||{}),updatedAt:Date.now()}));
      const send=m=>{ if(up){ if(up.open) up.send(m); } else conns.forEach(c=>{ if(c.open) c.send(m); }); };
      setPeer(myId,{});
      const room={name, peers:()=>cur, connected:()=>true,
        onPeers(h){ hs.add(h); setTimeout(fire,0); return ()=>hs.delete(h); },
        presence(patch){
          mine=Object.assign({},mine);
          for(const k in patch){ if(patch[k]===null) delete mine[k]; else mine[k]=patch[k]; }
          setPeer(myId,mine); send({t:'p',id:myId,p:mine}); fire(); return Promise.resolve();
        },
        leave(){ left=true; try{ peer.destroy() }catch(e){} return Promise.resolve(); }};
      const fail=()=>{ if(!settled){ settled=true; reject({code:'upstream_error'}); } };
      function asHub(){
        peer=new Peer(PRE+name);
        peer.on('open',()=>{ if(!settled){ settled=true; resolve(room); } });
        peer.on('connection',c=>{
          let cid=null;
          c.on('open',()=>{ peers.forEach((p,id)=>c.send({t:'p',id,p:p.presence})); });
          c.on('data',m=>{
            if(!m||m.t!=='p'||typeof m.id!=='string'||m.id===myId) return;
            cid=m.id; conns.set(cid,c); setPeer(cid,m.p);
            conns.forEach((o,oid)=>{ if(oid!==cid&&o.open) o.send(m); });
            fire();
          });
          const gone=()=>{
            if(cid&&conns.get(cid)===c){
              conns.delete(cid); peers.delete(cid);
              conns.forEach(o=>{ if(o.open) o.send({t:'bye',id:cid}); });
              fire();
            }
          };
          c.on('close',gone); c.on('error',gone);
        });
        peer.on('error',err=>{
          if(!settled&&err&&err.type==='unavailable-id'){ try{ peer.destroy() }catch(e){} asClient(); }
          else fail();
        });
      }
      function asClient(){
        peer=new Peer();
        peer.on('open',()=>{
          up=peer.connect(PRE+name,{reliable:true,serialization:'json'});
          up.on('open',()=>{ if(settled) return; settled=true; up.send({t:'p',id:myId,p:mine}); resolve(room); });
          up.on('data',m=>{
            if(!m) return;
            if(m.t==='p'&&typeof m.id==='string'&&m.id!==myId){ setPeer(m.id,m.p); fire(); }
            else if(m.t==='bye'){ peers.delete(m.id); fire(); }
          });
          const lost=()=>{ if(left) return; [...peers.keys()].forEach(id=>{ if(id!==myId) peers.delete(id); }); fire(); };
          up.on('close',lost); up.on('error',lost);
        });
        peer.on('error',fail);
      }
      asHub();
      setTimeout(fail,15000);
    });
  }
  /* look into several rooms without joining: a hub greets every new connection with everyone's presence, and we never introduce ourselves */
  function peek(names){
    return new Promise(resolve=>{
      const out={}, pending=new Set(names); let p=null, over=false;
      const done=()=>{ if(over) return; over=true; try{ p.destroy() }catch(e){} resolve(out); };
      const settle=n=>{ pending.delete(n); if(!pending.size) done(); };
      try{ p=new Peer(); }catch(e){ resolve(out); return; }
      p.on('open',()=>{
        names.forEach(n=>{
          const seen=new Map(), c=p.connect(PRE+n,{reliable:true,serialization:'json'});
          c.on('data',m=>{
            if(!m||m.t!=='p'||!m.p||typeof m.p.nick!=='string') return;
            if(!seen.size) setTimeout(()=>settle(n),500);   /* the rest of that room's greetings follow right behind */
            seen.set(m.id,m.p);
            const all=[...seen.values()], h=all.find(q=>q.host);
            out[n]={n:seen.size,play:all.some(q=>q.host&&q.phase==='play'),host:h?h.nick:''};
          });
        });
        setTimeout(done,4000);
      });
      p.on('error',e=>{
        if(!e||e.type!=='peer-unavailable'){ done(); return; }   /* peer-unavailable just means that room is empty */
        const n=names.find(x=>String(e.message||'').endsWith(PRE+x)); if(n) settle(n);
      });
      setTimeout(done,8000);
    });
  }
  window.claude={use:n=>Promise.resolve(n==='room'?{join,peek}:null)};
})();
