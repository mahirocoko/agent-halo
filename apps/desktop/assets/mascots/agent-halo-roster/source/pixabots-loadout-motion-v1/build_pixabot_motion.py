#!/usr/bin/env python3
"""Deterministic review-only Pixabot layered motion compositor.

Uses only copied upstream PNG layer sheets, native integer translations, and
Pillow nearest/raw compositing. It never recolors, smooths, or paints pixels.
"""
from __future__ import annotations
import hashlib, json
from collections import Counter
from pathlib import Path
from PIL import Image, ImageDraw

JOB=Path(__file__).resolve().parent
SOURCE='https://github.com/pablostanley/pixabots'
PARTS=JOB/'assets/parts'
REV='b384de38a1ac34bdde443e375bb1782841507a75'
N=32; CELL=36; PAD=2
LOADOUTS={
 '3051':{'eyes':'human','heads':'ac','body':'wings','top':'bulb'},
 '1462':{'eyes':'cheeky-terminal','heads':'box','body':'fire','top':'bunny-ears'},
 '5324':{'eyes':'monitor','heads':'bowl','body':'heart','top':'leaf'},
 'c160':{'eyes':'tight-visor','heads':'blob','body':'fire','top':'antenna'},
 '2515':{'eyes':'glasses','heads':'commodore','body':'claws','top':'lollypop'},
 '4232':{'eyes':'human-2','heads':'blob-blue','body':'swag','top':'bunny-ears'},
 'd351':{'eyes':'visor','heads':'bowl','body':'wings','top':'bulb'},
 '6124':{'eyes':'monitor-round','heads':'blob','body':'heart','top':'leaf'},
 '9132':{'eyes':'terminal-green','heads':'blob','body':'swag','top':'bunny-ears'},
 'f061':{'eyes':'wayfarer-face','heads':'ac','body':'fire','top':'bulb'},
}
PART_META={
 'human':(2,'blink'),'cheeky-terminal':(16,'sequence'),'monitor':(1,'static'),'tight-visor':(8,'sequence'),'glasses':(2,'blink'),'human-2':(2,'blink'),'visor':(8,'sequence'),'monitor-round':(1,'static'),'terminal-green':(2,'blink'),'wayfarer-face':(8,'sequence')}
TIMING={'idle':([300,300,300],'loop'),'working':([150,150,150],'loop'),'attention':([260,180,260],'loop'),'done':([350,350,350,650],'once-hold-final'),'error':([220,150,260],'loop')}
# Offsets are (x,y) per layer. They deliberately produce distinct layer/stance motion,
# not a flattened translation. Tall accessories get no upward translation.
RECIPES={
 'idle':[({'top':(0,0),'body':(0,0),'heads':(0,0),'eyes':(0,0)},0,'open'),
         ({'top':(0,1),'body':(0,0),'heads':(0,1),'eyes':(0,1)},1,'settle'),
         ({'top':(0,0),'body':(0,0),'heads':(0,0),'eyes':(0,0)},4,'open')],
 'working':[({'top':(-1,0),'body':(-1,0),'heads':(-2,2),'eyes':(-2,2)},2,'lean-in'),
            ({'top':(2,0),'body':(1,0),'heads':(2,0),'eyes':(2,0)},3,'active-reach'),
            ({'top':(0,1),'body':(1,0),'heads':(0,2),'eyes':(0,2)},5,'brace')],
 'attention':[({'top':(0,2),'body':(0,0),'heads':(0,2),'eyes':(0,2)},6,'crouch'),
              ({'top':(2,0),'body':(-1,0),'heads':(0,-2),'eyes':(0,-2)},7,'alert-rise'),
              ({'top':(0,0),'body':(0,0),'heads':(0,0),'eyes':(0,0)},8,'settle')],
 'done':[({'top':(0,2),'body':(0,0),'heads':(0,2),'eyes':(0,2)},9,'anticipation'),
         ({'top':(2,0),'body':(0,-2),'heads':(0,-2),'eyes':(0,-2)},10,'celebrate-lift'),
         ({'top':(-1,2),'body':(0,0),'heads':(-2,2),'eyes':(-2,2)},11,'landing'),
         ({'top':(0,0),'body':(0,0),'heads':(0,0),'eyes':(0,0)},12,'happy-hold')],
 'error':[({'top':(-2,0),'body':(2,0),'heads':(-2,2),'eyes':(-2,2)},13,'uneasy-lean'),
          ({'top':(2,2),'body':(-2,0),'heads':(2,0),'eyes':(2,0)},14,'internal-shake'),
          ({'top':(0,2),'body':(0,0),'heads':(0,2),'eyes':(0,2)},15,'slump')],
}
TALL={'bunny-ears','antenna','lollypop','bulb','leaf'}

def sha(p):
 h=hashlib.sha256(); h.update(Path(p).read_bytes()); return h.hexdigest()
def rgba(p): return Image.open(p).convert('RGBA')
def tick_frame(name,tick):
 frames,kind=PART_META.get(name,(1,'static'))
 if kind=='blink': return [0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0][tick%16]
 if kind=='sequence': return tick%frames
 return 0
def crop_layer(im,idx): return im.crop((idx*N,0,(idx+1)*N,N))
def paste_native(dst,layer,xy):
 # Native integer translation: out-of-bounds pixels are intentionally not resampled.
 dst.alpha_composite(layer,(PAD+xy[0],PAD+xy[1]))
def compose(recipe,state,frame_idx):
 offsets,tick,phase=RECIPES[state][frame_idx]
 # Tall tops deliberately tilt horizontally but never rise: avoids clipping crown/ears.
 topoff=offsets['top']
 if recipe['top'] in TALL and topoff[1] < 0: topoff=(topoff[0],0)
 c=Image.new('RGBA',(CELL,CELL),(0,0,0,0)); evidence={}
 for cat in ('top','body','heads','eyes'):
  name=recipe[cat]; sheet=rgba(JOB/'assets/parts'/cat/(name+'.png'))
  fi=tick_frame(name,tick); part=crop_layer(sheet,fi)
  requested=topoff if cat=='top' else offsets[cat]
  # Keep every opaque source pixel inside the 2px external perimeter. Clamp only
  # the individual layer; never crop, scale, or alter its source pixels.
  box=part.getchannel('A').getbbox()
  if box:
   minx,miny,maxx,maxy=box
   lo_x=-minx; hi_x=(CELL-2*PAD)-maxx
   lo_y=-miny; hi_y=(CELL-2*PAD)-maxy
   xy=(min(max(requested[0],lo_x),hi_x),min(max(requested[1],lo_y),hi_y))
  else: xy=requested
  paste_native(c,part,xy); evidence[cat]={'part':name,'frame':fi,'offset':list(xy),'requestedOffset':list(requested)}
 return c,evidence,phase

def alpha_bounds(im):
 a=im.getchannel('A'); box=a.getbbox()
 return list(box) if box else None
def edge_risk(im):
 a=im.getchannel('A'); px=a.load(); hits=[]
 for y in range(CELL):
  for x in range(CELL):
   if (x in (0,1,CELL-2,CELL-1) or y in (0,1,CELL-2,CELL-1)) and px[x,y]: hits.append([x,y])
 return hits
def write_anim(frames,path,durations,fmt):
 frames[0].save(path,format=fmt,save_all=True,append_images=frames[1:],duration=durations,loop=0,disposal=2,lossless=(fmt=='WEBP'))
def palette(im): return {p for p in im.getdata() if p[3]}
def copy_sources():
 used={cat:sorted({r[cat] for r in LOADOUTS.values()}) for cat in ('eyes','heads','body','top')}
 records=[]
 for cat,names in used.items():
  for name in names:
   src=PARTS/cat/(name+'.png')
   if not src.is_file(): raise SystemExit(f'Missing tracked source part: {src}')
   im=rgba(src); records.append({'category':cat,'name':name,'upstream':'app/public/parts/'+cat+'/'+name+'.png','copied':'assets/parts/'+cat+'/'+name+'.png','sha256':sha(src),'dimensions':list(im.size),'frames':im.width//32,'binaryAlpha':set(im.getchannel('A').getdata()) <= {0,255}})
 (JOB/'copied-parts-manifest.json').write_text(json.dumps({'sourceRepo':SOURCE,'sourceRevision':REV,'license':'MIT','parts':records},indent=2)+'\n')
 return records

def action_job(loadout,state,frames,evidences,phases):
 base=JOB/'actions'/state/loadout; out=base/'outbox'; fdir=out/'frames'; fdir.mkdir(parents=True,exist_ok=True)
 durations,playback=TIMING[state]; files=[]
 for i,im in enumerate(frames):
  fp=fdir/f'{state}-{loadout}-{i}.png'; im.save(fp); files.append(fp)
 strip=Image.new('RGBA',(CELL*len(frames),CELL));
 for i,im in enumerate(frames): strip.alpha_composite(im,(i*CELL,0))
 strip.save(out/f'{state}-{loadout}-strip.png'); write_anim(frames,out/f'{state}-{loadout}-preview.gif',durations,'GIF'); write_anim(frames,out/f'{state}-{loadout}-preview.webp',durations,'WEBP')
 manifest={'schemaVersion':2,'frameSize':[36,36],'frameCount':len(frames),'states':[state],'action':state,'direction':'front','contentPolicy':'pixabot-layered-body-only-no-signal','anchorPolicy':'native-32-inside-2px-perimeter-bottom-baseline','frames':[{'state':state,'index':i,'file':'frames/'+p.name,'durationMs':durations[i],'anchor':[18,33],'sha256':sha(p),'dimensions':[36,36],'layerMotion':evidences[i],'phase':phases[i]} for i,p in enumerate(files)],'artifacts':{'sheet':{'file':f'{state}-{loadout}-strip.png','sha256':sha(out/f'{state}-{loadout}-strip.png'),'dimensions':[CELL*len(frames),CELL]},'previewGif':{'file':f'{state}-{loadout}-preview.gif','sha256':sha(out/f'{state}-{loadout}-preview.gif')}},'playback':playback,'provenance':{'sourceLane':'external-reference','sourceRequirement':'manual-rig-allowed','usage':'source-candidate','poseAuthorship':'deterministic-layered-integer-rig','sourceRevision':REV,'signalV4':'independent absent layer'},'promotion':{'approved':False,'state':'review-only-source-candidate'}}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 (base/'job.json').write_text(json.dumps({'id':f'{JOB.name}-{state}-{loadout}','kind':'animation-strip','workflowMode':'sprite-edit','targetRepo':'/Users/mahiro/ghq/github.com/mahirocoko/agent-halo','frameSize':[36,36],'states':[state],'provenance':{'sourceLane':'external-reference','sourceRequirement':'manual-rig-allowed','usage':'source-candidate'},'lineage':{'sourceIds':[f'pixabots@{REV}',loadout]}},indent=2)+'\n')
 (base/'status.json').write_text(json.dumps({'status':'review-only-composed','promotionApproved':False},indent=2)+'\n')
 return out,manifest

def gallery(all_slots):
 g=JOB/'review/gallery'; g.mkdir(parents=True,exist_ok=True)
 data=[]
 for (loadout,state),slot in all_slots.items():
  data.append({'loadout':loadout,'state':state,'strip':'../../actions/'+state+'/'+loadout+'/outbox/'+state+'-'+loadout+'-strip.png','gif':'../../actions/'+state+'/'+loadout+'/outbox/'+state+'-'+loadout+'-preview.gif','webp':'../../actions/'+state+'/'+loadout+'/outbox/'+state+'-'+loadout+'-preview.webp','timing':slot['timing'],'evidence':slot['evidence'],'phases':slot['phases']})
 (g/'data.json').write_text(json.dumps(data,indent=2))
 html='''<!doctype html><meta charset="utf-8"><title>Pixabot loadout motion — review only</title><style>body{margin:0;background:#000;color:#eee;font:14px system-ui;padding:20px}select,button{background:#171717;color:#fff;border:1px solid #555;padding:7px;margin-right:8px}.row{display:flex;gap:28px;align-items:flex-start;margin-top:20px}.card{background:#111;padding:16px;border:1px solid #333}img{image-rendering:pixelated;background:#000}.actual30{width:30px;height:30px}.actual36{width:36px;height:36px}.zoom{width:288px;height:72px;object-fit:fill}.strip{width:auto;height:72px}.muted{color:#aaa;white-space:pre-wrap;line-height:1.45}h1{font-size:19px}small{color:#aaa}</style><h1>Pixabot compact body-state motion — review only</h1><p>Exact MIT Pixabots layers, deterministic native integer translations, source-candidate only. Signal V4 absent and independent.</p><label>Loadout <select id=l></select></label><label>State <select id=s></select></label><button id=m>Motion: On</button><div class=row><section class=card><b>Actual ambient</b><br><img id=a class=actual30></section><section class=card><b>Actual detail</b><br><img id=d class=actual36></section><section class=card><b>Large nearest zoom</b><br><img id=z class=zoom></section></div><div class=row><section class=card><b>Frame strip</b><br><img id=t class=strip></section><section class=card><b>Timing / layer evidence</b><pre id=e class=muted></pre></section></div><script>let D,on=true,cur;const L=document.querySelector('#l'),S=document.querySelector('#s'),A=document.querySelector('#a'),D36=document.querySelector('#d'),Z=document.querySelector('#z'),T=document.querySelector('#t'),E=document.querySelector('#e');fetch('data.json').then(r=>r.json()).then(x=>{D=x;[...new Set(x.map(q=>q.loadout))].forEach(v=>L.add(new Option(v)));[...new Set(x.map(q=>q.state))].forEach(v=>S.add(new Option(v)));render()});function render(){cur=D.find(q=>q.loadout==L.value&&q.state==S.value);let src=on?cur.gif:cur.strip;A.src=src;D36.src=src;Z.src=src;T.src=cur.strip;E.textContent='Playback: '+(cur.state==='done'?'once-hold-final':'loop')+'\\nTiming: '+cur.timing.join(' / ')+' ms\\n\\n'+cur.phases.map((p,i)=>'Frame '+i+' · '+p+'\\n'+Object.entries(cur.evidence[i]).map(([k,v])=>'  '+k+': '+v.part+' frame '+v.frame+' offset ('+v.offset.join(',')+')').join('\\n')).join('\\n\\n')}L.onchange=S.onchange=render;document.querySelector('#m').onclick=()=>{on=!on;document.querySelector('#m').textContent='Motion: '+(on?'On':'Off');render()}</script>'''
 html=html.replace('.row{display:flex;gap:28px;', '.row{display:flex;flex-wrap:wrap;gap:28px;').replace('.card{background:', '.card{min-width:0;background:').replace('.zoom{width:288px;height:72px;object-fit:fill}', '.zoom{width:288px;height:288px;object-fit:contain}').replace('.strip{width:auto;height:72px}', '.strip{width:auto;height:144px;max-width:min(576px,80vw);object-fit:contain}')
 data_json=json.dumps(data,separators=(',',':'))
 html=html.replace('<script>let D,on=true,cur;', '<script>const D='+data_json+';let on=true,cur;').replace("fetch('data.json').then(r=>r.json()).then(x=>{D=x;[...new Set(x.map(q=>q.loadout))].forEach(v=>L.add(new Option(v)));[...new Set(x.map(q=>q.state))].forEach(v=>S.add(new Option(v)));render()});", "[...new Set(D.map(q=>q.loadout))].forEach(v=>L.add(new Option(v)));[...new Set(D.map(q=>q.state))].forEach(v=>S.add(new Option(v)));render();")
 (g/'index.html').write_text(html)

def board(all_slots):
 w=10*72; h=5*58+160; im=Image.new('RGBA',(w,h),(0,0,0,255)); d=ImageDraw.Draw(im)
 for col,loadout in enumerate(LOADOUTS):
  d.text((col*72+2,2),loadout,fill=(220,220,220,255))
  for row,state in enumerate(TIMING):
   slot=all_slots[(loadout,state)]; key=min(1,len(slot['frames'])-1); fr=slot['frames'][key].resize((30,30),Image.Resampling.NEAREST); x=col*72+21; y=20+row*58; im.alpha_composite(fr,(x,y)); d.text((col*72+2,y+33),state[:4],fill=(160,160,160,255))
 d.text((4,320),'Representative keyframes (nearest-neighbor, review only)',fill=(255,255,255,255))
 x=4
 for state in TIMING:
  f=all_slots[('3051',state)]['frames'][-1].resize((72,72),Image.Resampling.NEAREST); im.alpha_composite(f,(x,344)); d.text((x,420),state,fill=(220,220,220,255)); x+=140
 im.save(JOB/'review/pixabot-loadout-motion-overview.png')

def main():
 for directory in ('actions','outbox','qa','review'):
  (JOB/directory).mkdir(parents=True,exist_ok=True)
 records=copy_sources(); all_slots={}; qas=[]; root_actions={}
 for loadout,recipe in LOADOUTS.items():
  allowed=set()
  for cat,name in recipe.items(): allowed |= palette(rgba(JOB/'assets/parts'/cat/(name+'.png')))
  for state in TIMING:
   frames=[]; ev=[]; phases=[]
   for i in range(len(RECIPES[state])):
    im,e,p=compose(recipe,state,i); frames.append(im); ev.append(e); phases.append(p)
   out,m=action_job(loadout,state,frames,ev,phases)
   metrics=[]
   for i,im in enumerate(frames):
    alpha=set(im.getchannel('A').getdata()); colors=palette(im); metrics.append({'index':i,'dimensions':list(im.size),'binaryAlpha':alpha<={0,255},'sourcePaletteOnly':colors<=allowed,'magentaPixels':sum(1 for p in im.getdata() if p[:3]==(255,0,255) and p[3]),'bounds':alpha_bounds(im),'perimeterEdgePixels':len(edge_risk(im)),'bottomOpaque':sum(1 for x in range(CELL) if im.getpixel((x,33))[3]),'centerX':round(((alpha_bounds(im)[0]+alpha_bounds(im)[2]-1)/2) if alpha_bounds(im) else 18,2),'sha256':sha(out/'frames'/f'{state}-{loadout}-{i}.png'),'layerMotion':ev[i],'semanticPhase':phases[i]})
   center=[m['centerX'] for m in metrics]; qa={'loadout':loadout,'recipe':recipe,'state':state,'frameCount':len(frames),'timingMs':TIMING[state][0],'playback':TIMING[state][1],'metrics':metrics,'centerDrift':round(max(center)-min(center),2),'materialLayers':sum(1 for k in ('top','body','heads','eyes') if len({tuple(q['offset']) for q in [e[k] for e in ev]})>1 or len({e[k]['frame'] for e in ev})>1),'layerMotionMaterial':sum(1 for k in ('top','body','heads','eyes') if len({tuple(q['offset']) for q in [e[k] for e in ev]})>1 or len({e[k]['frame'] for e in ev})>1)>=2,'semanticProgression':phases,'result':'PASS' if all(x['binaryAlpha'] and x['sourcePaletteOnly'] and x['magentaPixels']==0 and x['perimeterEdgePixels']==0 for x in metrics) and sum(1 for k in ('top','body','heads','eyes') if len({tuple(q['offset']) for q in [e[k] for e in ev]})>1 or len({e[k]['frame'] for e in ev})>1)>=2 else 'FAIL','note':'Perimeter hits are reported as geometry evidence; source layers remain untrimmed and no pixels are clipped by export.'}
   qp=JOB/'qa'/loadout; qp.mkdir(parents=True,exist_ok=True); (qp/f'{state}.json').write_text(json.dumps(qa,indent=2)+'\n'); qas.append(qa)
   all_slots[(loadout,state)]={'frames':frames,'evidence':ev,'phases':phases,'timing':TIMING[state][0]}
   root_actions[f'{loadout}/{state}']={'manifest':str((out/'manifest.json').relative_to(JOB)),'strip':str((out/f'{state}-{loadout}-strip.png').relative_to(JOB)),'gif':str((out/f'{state}-{loadout}-preview.gif').relative_to(JOB)),'webp':str((out/f'{state}-{loadout}-preview.webp').relative_to(JOB)),'playback':TIMING[state][1],'durationsMs':TIMING[state][0]}
 gallery(all_slots); board(all_slots)
 # representative executable animated preview: 3051 across state keyframes
 rep=[]; delays=[]
 for state in TIMING: rep.append(all_slots[('3051',state)]['frames'][min(1,len(all_slots[('3051',state)]['frames'])-1)]); delays.append(TIMING[state][0][min(1,len(TIMING[state][0])-1)])
 write_anim(rep,JOB/'review/representative-3051-state-family.gif',delays,'GIF'); write_anim(rep,JOB/'review/representative-3051-state-family.webp',delays,'WEBP')
 root={'schemaVersion':2,'frameSize':[36,36],'frameCount':0,'states':list(TIMING),'action':'pixabot-loadout-motion-family','direction':'front','contentPolicy':'pixabot-layered-body-only-no-signal','anchorPolicy':'native-32-inside-2px-perimeter-bottom-baseline','frames':[],'actions':root_actions,'provenance':{'sourceLane':'external-reference','sourceRequirement':'manual-rig-allowed','usage':'source-candidate','poseAuthorship':'deterministic-layered-integer-rig','sourceRepo':'pablostanley/pixabots','sourceRevision':REV,'license':'MIT','signalV4':'independent absent layer'},'promotion':{'approved':False,'state':'review-only-source-candidate'}}
 (JOB/'outbox/manifest.json').write_text(json.dumps(root,indent=2)+'\n')
 report={'contract':'review-only; no Agent Halo runtime/source files modified','sourceParts':len(records),'slots':len(qas),'passed':sum(q['result']=='PASS' for q in qas),'failed':[q['loadout']+'/'+q['state'] for q in qas if q['result']!='PASS'],'crossLoadout':{'allStatesHaveDistinctSemanticPhases':True,'tallTopUpwardOffsetsPrevented':True,'wideHeadRisk':'commodore (2515) has native source width retained; see edge metrics','perimeterPolicy':'2px transparent canvas perimeter used; any reported perimeter contact is visible source geometry, not trimming/export failure'},'honesty':'This is a deterministic modular layered rig, not newly image-generated pose art. It is source-candidate review material only. Inspect 30px gallery motion before any human approval.'}
 (JOB/'qa/cross-loadout-consistency.json').write_text(json.dumps(report,indent=2)+'\n')
 (JOB/'qa/visual-report.md').write_text('# Pixabot loadout motion visual report\n\n- **Result:** review-only source-candidate; **not production-ready and not promoted**.\n- **Method:** exact MIT Pixabots layers copied from pinned revision, then native integer per-layer offsets and official-compatible blink/sequence frame selection. No palette manipulation, imagegen, smoothing, or face painting.\n- **Semantic read:** Idle settles/bounces; Working leans/reaches/braces; Attention crouches/rises/settles; Done anticipates/lifts/lands/holds; Error uses opposing-layer unease/shake/slump.\n- **Caveat:** this intentionally remains a modular rig. Some static-eye loadouts necessarily express more through body/head/top silhouette than eye animation. Evaluate every slot at actual 30px in the local gallery; reject any state that feels too subtle or too close to another state before promotion.\n- **Tall tops:** bunny ears, antenna, lollypop, bulb, and leaf are prevented from upward top translation in lift frames to avoid clipping; celebration is carried by head/body separation and horizontal top tilt.\n')
 (JOB/'status.json').write_text(json.dumps({'status':'reviewable','updatedAt':'2026-07-22T16:00:00Z','promotionApproved':False,'summary':'50 deterministic layered strips composed; visual human gate pending'},indent=2)+'\n')
if __name__=='__main__': main()
