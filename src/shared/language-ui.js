(function(root){
  const originals=new WeakMap(), attributes=new WeakMap();
  const pageTitle=document.title;
  const select=document.getElementById('popupLanguage');
  const options=document.getElementById('countryOptions');
  const countries=root.RadarI18n.COUNTRIES;
  let activeIndex=0;
  let saving=false;
  // Local display layer: preserve original tweets, quoted evidence and input.
  function paint(){
    observer.disconnect();
    root.RadarI18n.apply();
    document.title=root.RadarUiCopy.translate(pageTitle);
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      if(node.parentElement?.closest('script,style,blockquote,textarea,#popupLanguage option,[data-no-translate]')) continue;
      const saved=originals.get(node);
      const source=saved && node.textContent===saved.output ? saved.source : node.textContent;
      const output=root.RadarUiCopy.translate(source);
      if(output!==node.textContent) node.textContent=output;
      originals.set(node,{source,output});
    }
    for(const el of document.querySelectorAll('[aria-label],[title],[placeholder]')){
      if(el.closest('blockquote,.news-link,[data-no-translate]')) continue;
      const history=attributes.get(el)||{};
      for(const key of ['aria-label','title','placeholder']){
        if(!el.hasAttribute(key)) continue;
        const current=el.getAttribute(key), saved=history[key];
        const source=saved && current===saved.output ? saved.source : current;
        const output=root.RadarUiCopy.translate(source);
        if(output!==current) el.setAttribute(key,output);
        history[key]={source,output};
      }
      attributes.set(el,history);
    }
    // Localize only the action prefix; the following quoted post is untouched.
    for(const link of document.querySelectorAll('.news-link[aria-label]')){
      const label=link.getAttribute('aria-label'), separator=label.indexOf(': ');
      if(separator>=0) link.setAttribute('aria-label',root.RadarUiCopy.translate('원문 보기')+': '+label.slice(separator+2));
    }
    if(select){
      const country=countries.find(item=>item.locale===root.RadarI18n.uiLanguage()) || countries[0];
      document.getElementById('countryFlag').src='../../assets/flag-'+country.code+'.svg';
      document.getElementById('countryName').textContent=country.name;
      for(const option of options.children) option.setAttribute('aria-selected',String(option.dataset.locale===country.locale));
    }
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  }
  const observer=new MutationObserver(paint);
  root.RadarI18n.subscribe(paint);
  root.RadarI18n.ready.then(()=>{paint();if(select) select.disabled=false;});
  function focusOption(index){
    activeIndex=(index+countries.length)%countries.length;
    for(const [i,option] of Array.from(options.children).entries()) option.classList.toggle('is-focused',i===activeIndex);
    select.setAttribute('aria-activedescendant',options.children[activeIndex].id);
  }
  function close(){
    options.hidden=true;select.setAttribute('aria-expanded','false');select.removeAttribute('aria-activedescendant');
  }
  function open(){
    if(saving || select.disabled) return;
    options.hidden=false;select.setAttribute('aria-expanded','true');
    focusOption(countries.findIndex(item=>item.locale===root.RadarI18n.uiLanguage()));
  }
  async function choose(value){
    close();
    if(saving || value===root.RadarI18n.uiLanguage()) return;
    saving=true;select.disabled=true;select.dataset.state='loading';
    try{
      await root.RadarI18n.save(value);
      select.dataset.state='success';
      document.getElementById('themeStatus').dataset.state='success';
      document.getElementById('themeStatus').textContent=root.RadarUiCopy.translate('언어를 저장했습니다.');
    }catch{
      select.dataset.state='error';
      const status=document.getElementById('themeStatus');status.dataset.state='error';status.textContent=root.RadarUiCopy.translate('언어를 저장하지 못했어요. 다시 선택해 주세요.');
    }finally{saving=false;select.disabled=false;paint();select.focus();}
  }
  if(select && options){
    options.dataset.noTranslate='';
    for(const [index,country] of countries.entries()){
      const option=document.createElement('div');option.className='country-option';option.id='country-'+country.code;
      option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.dataset.locale=country.locale;
      const flag=document.createElement('img');flag.src='../../assets/flag-'+country.code+'.svg';flag.width=16;flag.height=12;flag.alt='';
      const label=document.createElement('span');label.textContent=country.name;option.append(flag,label);
      option.addEventListener('pointerdown',event=>event.preventDefault());
      option.addEventListener('pointermove',()=>focusOption(index));
      option.addEventListener('click',()=>choose(country.locale));options.append(option);
    }
    select.addEventListener('click',()=>options.hidden?open():close());
    select.addEventListener('keydown',event=>{
      if(event.key==='Escape'){close();event.preventDefault();return;}
      if(event.key==='Tab'){close();return;}
      if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){
        event.preventDefault();
        if(options.hidden){open();return;}
        if(event.key==='Enter'||event.key===' ') choose(countries[activeIndex].locale);
        else focusOption(event.key==='Home'?0:event.key==='End'?countries.length-1:activeIndex+(event.key==='ArrowUp'?-1:1));
      }
    });
    document.addEventListener('pointerdown',event=>{if(!select.parentElement.contains(event.target))close();});
    select.addEventListener('blur',close);
  }
})(globalThis);
