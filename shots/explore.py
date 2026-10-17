import json
from playwright.sync_api import sync_playwright
L=open('/workspace/hotel-retest/staging-ba.creds').read().strip().splitlines()
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    c=b.new_context(http_credentials={'username':L[0],'password':L[1]},viewport={'width':1280,'height':900})
    pg=c.new_page()
    r=pg.goto('https://staging.saliminn.my/login',wait_until='networkidle')
    print('page',r.status)
    res=pg.evaluate("""async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin'}),credentials:'include'});const t=await r.text();let j;try{j=JSON.parse(t)}catch(e){j=null};return {s:r.status,keys:j?Object.keys(j):t.slice(0,200)}}""")
    print(res)
    pg.screenshot(path='/workspace/bulk-price/shots/explore.png')
    b.close()
