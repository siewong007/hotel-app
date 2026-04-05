import{r as e}from"./chunk-DECur_0Z.js";import{dt as t,it as n,n as r,st as i,t as a,v as o}from"./Box-DW_5dheM.js";import{n as s}from"./IconButton-BnYrccDu.js";import{t as c}from"./Alert-CU5ohjlW.js";import{t as l}from"./AlertTitle-DdYYm55e.js";import{t as u}from"./Button-CvAFU7EQ.js";import"./LandingPage-DJfKrEhw.js";import{t as d}from"./Refresh-CXkwb0Hg.js";import"./ModernDatePicker-CVasJDTC.js";var f=n(),p=o((0,f.jsx)(`path`,{d:`M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z`}),`Home`),m=o((0,f.jsx)(`path`,{d:`M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5s-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20zm-6 8h-4v-2h4zm0-4h-4v-2h4z`}),`BugReport`),h=e(t()),g={fade:`smoothFadeIn 0.2s ease-out forwards`,slide:`smoothSlideIn 0.2s ease-out forwards`,grow:`smoothGrowIn 0.2s ease-out forwards`},_=({children:e,animationType:t=`fade`})=>(0,f.jsx)(a,{sx:{width:`100%`,minHeight:`100%`,animation:g[t],transform:`translateZ(0)`,backfaceVisibility:`hidden`},children:e}),v=(0,h.createContext)(null),y={didCatch:!1,error:null},b=class extends h.Component{constructor(e){super(e),this.resetErrorBoundary=this.resetErrorBoundary.bind(this),this.state=y}static getDerivedStateFromError(e){return{didCatch:!0,error:e}}resetErrorBoundary(){let{error:e}=this.state;if(e!==null){var t,n,r=[...arguments];(t=(n=this.props).onReset)==null||t.call(n,{args:r,reason:`imperative-api`}),this.setState(y)}}componentDidCatch(e,t){var n,r;(n=(r=this.props).onError)==null||n.call(r,e,t)}componentDidUpdate(e,t){let{didCatch:n}=this.state,{resetKeys:r}=this.props;if(n&&t.error!==null&&x(e.resetKeys,r)){var i,a;(i=(a=this.props).onReset)==null||i.call(a,{next:r,prev:e.resetKeys,reason:`keys`}),this.setState(y)}}render(){let{children:e,fallbackRender:t,FallbackComponent:n,fallback:r}=this.props,{didCatch:i,error:a}=this.state,o=e;if(i){let e={error:a,resetErrorBoundary:this.resetErrorBoundary};if(typeof t==`function`)o=t(e);else if(n)o=(0,h.createElement)(n,e);else if(r!==void 0)o=r;else throw a}return(0,h.createElement)(v.Provider,{value:{didCatch:i,error:a,resetErrorBoundary:this.resetErrorBoundary}},o)}};function x(){let e=arguments.length>0&&arguments[0]!==void 0?arguments[0]:[],t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:[];return e.length!==t.length||e.some((e,n)=>!Object.is(e,t[n]))}function S({error:e,resetErrorBoundary:t,title:n=`Something went wrong`}){return(0,f.jsx)(a,{sx:{display:`flex`,justifyContent:`center`,alignItems:`center`,minHeight:`400px`,p:3},children:(0,f.jsxs)(s,{elevation:3,sx:{p:4,maxWidth:600,width:`100%`,textAlign:`center`},children:[(0,f.jsx)(m,{sx:{fontSize:64,color:`error.main`,mb:2}}),(0,f.jsx)(r,{variant:`h4`,gutterBottom:!0,color:`error`,children:n}),(0,f.jsxs)(c,{severity:`error`,sx:{mt:2,mb:3,textAlign:`left`},children:[(0,f.jsx)(l,{children:`Error Details`}),e.message||`An unexpected error occurred`]}),!1,(0,f.jsxs)(a,{sx:{mt:3,display:`flex`,gap:2,justifyContent:`center`},children:[(0,f.jsx)(u,{variant:`contained`,color:`primary`,startIcon:(0,f.jsx)(d,{}),onClick:t,children:`Try Again`}),(0,f.jsx)(u,{variant:`outlined`,startIcon:(0,f.jsx)(p,{}),onClick:()=>window.location.href=`/`,children:`Go Home`})]}),(0,f.jsx)(r,{variant:`caption`,color:`text.secondary`,sx:{mt:3,display:`block`},children:`If this problem persists, please contact support`})]})})}function C({children:e,title:t,onError:n,onReset:r}){return(0,f.jsx)(b,{FallbackComponent:e=>(0,f.jsx)(S,{...e,title:t}),onError:(e,t)=>{n&&n(e,t)},onReset:()=>{r&&r()},children:e})}function w({children:e}){return(0,f.jsx)(C,{title:`Page Error`,onError:(e,t)=>{console.error(`Page Error:`,e,t)},onReset:()=>{sessionStorage.clear(),window.location.reload()},children:e})}function T({children:e}){return(0,f.jsx)(C,{title:`Component Error`,onError:e=>{console.warn(`Component Error:`,e)},children:e})}var E=i`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`,D=i`
  0%, 100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
`,O=({size:e=120})=>{let t=`#26a69a`;return(0,f.jsxs)(a,{sx:{display:`flex`,flexDirection:`column`,justifyContent:`center`,alignItems:`center`,minHeight:e+60,gap:2},children:[(0,f.jsxs)(a,{sx:{position:`relative`,width:e,height:e},children:[(0,f.jsx)(a,{sx:{position:`absolute`,width:`100%`,height:`100%`,borderRadius:`50%`,border:`${e*.06}px solid transparent`,borderTopColor:t,borderRightColor:`${t}40`,animation:`${E} 0.8s linear infinite`,transform:`translateZ(0)`}}),(0,f.jsx)(a,{sx:{position:`absolute`,width:`60%`,height:`60%`,top:`20%`,left:`20%`,borderRadius:`50%`,background:`linear-gradient(135deg, ${t}30, #00bcd420)`,animation:`${D} 1.2s ease-in-out infinite`}})]}),(0,f.jsx)(r,{sx:{fontSize:Math.max(e*.11,12),color:`#1a4d42`,fontWeight:500,letterSpacing:`0.03em`},children:`Loading...`})]})},k=i`
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
`,A=i`
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.8);
  }
`,j=i`
  0%, 80%, 100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
`,M=({size:e=40,color:t=`#26a69a`,variant:n=`circular`})=>n===`dots`?(0,f.jsx)(a,{sx:{display:`inline-flex`,alignItems:`center`,justifyContent:`center`,gap:`${e*.15}px`},children:[0,1,2].map(n=>(0,f.jsx)(a,{sx:{width:e*.25,height:e*.25,borderRadius:`50%`,backgroundColor:t,animation:`${j} 1.4s ease-in-out infinite`,animationDelay:`${n*.16}s`}},n))}):(0,f.jsxs)(a,{sx:{position:`relative`,width:e,height:e,display:`inline-flex`,alignItems:`center`,justifyContent:`center`},children:[(0,f.jsx)(a,{sx:{position:`absolute`,width:`100%`,height:`100%`,borderRadius:`50%`,border:`${Math.max(2,e*.08)}px solid transparent`,borderTopColor:t,borderRightColor:`${t}60`,animation:`${k} 1s linear infinite`}}),(0,f.jsx)(a,{sx:{width:`50%`,height:`50%`,borderRadius:`50%`,background:`linear-gradient(135deg, ${t}40, ${t}20)`,animation:`${A} 1.5s ease-in-out infinite`}})]});export{w as a,C as i,O as n,_ as o,T as r,p as s,M as t};