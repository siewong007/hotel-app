const i=e=>!e||!e.trim()?"Email is required":/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())?"":"Please enter a valid email address",s=e=>i(e)==="";export{s as i,i as v};
