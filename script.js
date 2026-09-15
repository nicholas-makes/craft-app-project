(function () {
  'use strict';

  /* ---------------- viewport auto-scale ---------------- */
  var scaler = document.getElementById('scaler');
  var FRAME_W = 393; // outer bezel border is included in this box (border-box)
  var FRAME_H = 852;

  function fitToViewport() {
    // Mobile browsers resize window.innerHeight as their address bar
    // shows/hides, and `resize` doesn't fire reliably for that -- visualViewport
    // tracks the real, currently-visible area so the frame never ends up scaled
    // for a taller viewport than what's actually on screen (which cut off the
    // bottom of the phone, exposing the page's white background past its
    // rounded corners and forcing a real scroll on the page).
    var vv = window.visualViewport;
    var viewportW = vv ? vv.width : window.innerWidth;
    var viewportH = vv ? vv.height : window.innerHeight;
    var margin = 24;
    var availW = viewportW - margin * 2;
    var availH = viewportH - margin * 2;
    var scale = Math.min(availW / FRAME_W, availH / FRAME_H, 1);
    scaler.style.transform = 'scale(' + scale + ')';
  }
  window.addEventListener('resize', fitToViewport);
  window.addEventListener('orientationchange', fitToViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitToViewport);
    window.visualViewport.addEventListener('scroll', fitToViewport);
  }
  fitToViewport();

  /* ---------------- custom cursor ---------------- */
  var customCursor = document.getElementById('custom-cursor');
  var cursorDot = customCursor.querySelector('.cursor-dot');

  window.addEventListener('mousemove', function (e) {
    customCursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
  });

  window.addEventListener('mousedown', function () {
    cursorDot.classList.remove('pressing');
    // restart the animation even if it's already mid-play
    void cursorDot.offsetWidth;
    cursorDot.classList.add('pressing');
  });

  cursorDot.addEventListener('animationend', function () {
    cursorDot.classList.remove('pressing');
  });

  /* ---------------- drag-to-scroll with momentum + rubber-band bounce (no wheel) ----
     Tuned to feel like native iOS momentum scrolling:
     - velocity is smoothed (EMA) across samples instead of taken from a single,
       possibly-noisy pointermove, so a flick doesn't feel jittery.
     - momentum decay is timestamp-based (not per-frame), so it plays back at the
       same speed regardless of display refresh rate.
     - dragging (or flinging) past the top/bottom stretches the list via a
       diminishing-return transform -- decoupled from the real scrollTop, which
       stays clamped to [0, maxScroll] -- then springs back on release. Because
       the stretch never depends on there being real scrollable range, a list
       whose content doesn't overflow its box still bounces on every drag,
       exactly like an empty/short list does natively on iOS. */
  var DRAG_THRESHOLD = 6; // px of movement before a press becomes a scroll-drag
  var MAX_OVERSCROLL = 70; // px, cap on how far the rubber-band can stretch
  var OVERSCROLL_RESISTANCE = 0.45; // fraction of past-the-edge drag that actually stretches

  function enableDragScroll(el) {
    var armed = false;   // pointer is down, but we haven't decided drag-vs-tap yet
    var dragging = false; // movement exceeded the threshold -- now actually scrolling
    var pointerId = null;
    var startY = 0;
    var startScrollTop = 0;
    var lastY = 0;
    var lastT = 0;
    var velocity = 0; // px per ms
    var momentumId = null;
    var lastFrameT = 0;
    var overscroll = 0; // px, visual-only stretch past the real scroll bounds
    var springId = null;
    var springLastT = 0;

    function applyOverscroll() {
      el.style.transform = overscroll ? 'translateY(' + overscroll.toFixed(2) + 'px)' : '';
    }

    function stopSpring() {
      if (springId) {
        cancelAnimationFrame(springId);
        springId = null;
      }
    }

    function springStep(t) {
      var dt = springLastT ? Math.min(t - springLastT, 48) : 16.7;
      springLastT = t;
      overscroll *= Math.pow(0.05, dt / 200); // fast, smooth ease back to rest
      if (Math.abs(overscroll) < 0.5) {
        overscroll = 0;
        applyOverscroll();
        springId = null;
        springLastT = 0;
        return;
      }
      applyOverscroll();
      springId = requestAnimationFrame(springStep);
    }

    function springBack() {
      stopSpring();
      springLastT = 0;
      springId = requestAnimationFrame(springStep);
    }

    function stopMomentum() {
      if (momentumId) {
        cancelAnimationFrame(momentumId);
        momentumId = null;
      }
    }

    function runMomentum(t) {
      var dt = lastFrameT ? Math.min(t - lastFrameT, 48) : 16.7;
      lastFrameT = t;

      // Frame-rate independent exponential decay (~0.95 per 16.7ms frame).
      velocity *= Math.pow(0.95, dt / 16.7);

      var maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      var next = el.scrollTop - velocity * dt;

      if (next < 0 || next > maxScroll) {
        var excess = next < 0 ? -next : next - maxScroll;
        overscroll = (next < 0 ? 1 : -1) * Math.min(excess * OVERSCROLL_RESISTANCE, MAX_OVERSCROLL);
        applyOverscroll();
        el.scrollTop = next < 0 ? 0 : maxScroll;
        velocity *= 0.55;
      } else {
        el.scrollTop = next;
      }

      if (Math.abs(velocity) < 0.02) {
        momentumId = null;
        lastFrameT = 0;
        if (overscroll) springBack();
        return;
      }
      momentumId = requestAnimationFrame(runMomentum);
    }

    el.addEventListener('pointerdown', function (e) {
      // Let a click-drag inside a text field select text normally instead of
      // hijacking it as a scroll gesture.
      if (e.target.closest('input, textarea')) return;
      armed = true;
      dragging = false;
      pointerId = e.pointerId;
      stopMomentum();
      stopSpring();
      startY = e.clientY;
      lastY = e.clientY;
      lastT = performance.now();
      velocity = 0;
      startScrollTop = el.scrollTop;
      // Deliberately do NOT capture the pointer here -- a plain tap on a
      // list item (e.g. picking a unit) must fire its native click
      // undisturbed. Capture only kicks in once we confirm a real drag.
    });

    el.addEventListener('pointermove', function (e) {
      if (!armed) return;
      var delta = e.clientY - startY;

      if (!dragging) {
        if (Math.abs(delta) < DRAG_THRESHOLD) return;
        dragging = true;
        el.setPointerCapture(pointerId);
        document.body.classList.add('dragging-scroll');
      }

      var now = performance.now();
      var maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      var target = startScrollTop - delta;

      if (target < 0) {
        el.scrollTop = 0;
        overscroll = Math.min(-target * OVERSCROLL_RESISTANCE, MAX_OVERSCROLL);
      } else if (target > maxScroll) {
        el.scrollTop = maxScroll;
        overscroll = -Math.min((target - maxScroll) * OVERSCROLL_RESISTANCE, MAX_OVERSCROLL);
      } else {
        el.scrollTop = target;
        overscroll = 0;
      }
      applyOverscroll();

      var dt = now - lastT;
      if (dt > 0) {
        var instant = (e.clientY - lastY) / dt; // px per ms
        // Exponential moving average smooths out noisy per-event deltas.
        velocity = velocity ? velocity * 0.7 + instant * 0.3 : instant;
      }
      lastY = e.clientY;
      lastT = now;
    });

    function endDrag() {
      armed = false;
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('dragging-scroll');
      if (overscroll) {
        // Already stretched past the edge -- spring back rather than fling.
        springBack();
        return;
      }
      if (Math.abs(velocity) > 0.03) {
        lastFrameT = 0;
        momentumId = requestAnimationFrame(runMomentum);
      }
    }

    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    // Ignore mouse wheel / trackpad scrolling entirely -- drag only, like a phone.
    el.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
  }

  enableDragScroll(document.getElementById('list-products'));
  enableDragScroll(document.getElementById('list-ingredients'));
  enableDragScroll(document.getElementById('unit-list'));
  enableDragScroll(document.getElementById('modal-add-scroll'));
  enableDragScroll(document.getElementById('pf-product-list'));
  enableDragScroll(document.getElementById('pf-step2-scroll'));
  enableDragScroll(document.getElementById('plan-page-scroll'));

  /* ---------------- catalog: Products / Ingredients toggle ---------------- */
  var tabProducts = document.getElementById('tab-products');
  var tabIngredients = document.getElementById('tab-ingredients');
  var listProducts = document.getElementById('list-products');
  var listIngredients = document.getElementById('list-ingredients');

  tabProducts.addEventListener('click', function () {
    tabProducts.classList.add('active');
    tabIngredients.classList.remove('active');
    listProducts.hidden = false;
    listIngredients.hidden = true;
  });

  tabIngredients.addEventListener('click', function () {
    tabIngredients.classList.add('active');
    tabProducts.classList.remove('active');
    listIngredients.hidden = false;
    listProducts.hidden = true;
  });

  /* ---------------- bottom nav (Catalog + Plan are real pages; Home/Analytics/
     Profile aren't built out, so clicking them shows the selected state --
     pill highlight and the actual selected icon graphic -- without navigating
     anywhere, matching Figma's nav-bar component states for every icon.
     Each page has its own copy of the nav-bar, so every update below applies
     to all of them at once to keep them in sync when the page changes. */
  var pageCatalog = document.getElementById('page-catalog');
  var pagePlan = document.getElementById('page-plan');

  function setActiveNav(navName) {
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      var isActive = btn.dataset.nav === navName;
      btn.classList.toggle('active', isActive);
      var img = btn.querySelector('img');
      img.src = 'assets/nav/' + btn.dataset.nav + (isActive ? '-selected.svg' : '-unselected.svg');
    });
  }

  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var navName = btn.dataset.nav;
      setActiveNav(navName);
      if (navName === 'catalog') {
        pageCatalog.hidden = false;
        pagePlan.hidden = true;
      } else if (navName === 'plan') {
        pageCatalog.hidden = true;
        pagePlan.hidden = false;
        renderPlanCardsTop();
      }
      // Home/Analytics/Profile: no page to switch to, so the current one stays.
    });
  });

  /* ---------------- Add Name modal ---------------- */
  var modalAdd = document.getElementById('modal-add');
  var btnOpenAdd = document.getElementById('btn-open-add');
  var btnCancel = document.getElementById('btn-cancel');
  var nameInput = document.getElementById('name-input');

  var filterProduct = document.getElementById('filter-product');
  var filterIngredient = document.getElementById('filter-ingredient');
  var productTabContent = document.getElementById('product-tab-content');
  var ingredientTabContent = document.getElementById('ingredient-tab-content');

  var unitSlot = document.getElementById('unit-slot');
  var radioUnitHeader = document.getElementById('radio-unit-header');
  var unitFields = document.getElementById('unit-fields');
  var measurableSlot = document.getElementById('measurable-slot');
  var radioMeasurableHeader = document.getElementById('radio-measurable-header');
  var measurableFields = document.getElementById('measurable-fields');

  var unitRow = document.getElementById('unit-row');
  var unitField = document.getElementById('unit-field');
  var totalField = document.getElementById('total-field');
  var amountRow = document.getElementById('amount-row');
  var amountField = document.getElementById('amount-field');
  var roughRow = document.getElementById('rough-row');
  var roughField = document.getElementById('rough-field');
  var bufferRow = document.getElementById('buffer-row');
  var bufferField = document.getElementById('buffer-field');
  var costLabel = document.getElementById('cost-label');
  var costValue = document.getElementById('cost-value');
  var btnCreate = document.getElementById('btn-create');

  var btnOpenUnitPicker = document.getElementById('btn-open-unit-picker');
  var btnCloseUnitPicker = document.getElementById('btn-close-unit-picker');
  var unitPicker = document.getElementById('unit-picker');
  var unitList = document.getElementById('unit-list');
  var scrollbarThumb = document.getElementById('scrollbar-thumb');

  var state = {
    itemType: null, // null | 'measurable' | 'unit' -- nothing selected until the user taps a radio
    unit: null,
    branch: null // 'granular' | 'rough'
  };

  function collapseSlot(slot, header, fields) {
    slot.classList.remove('expanded');
    header.classList.remove('selected');
    fields.hidden = true;
  }

  function resetModalState() {
    state.itemType = null;
    state.unit = null;
    state.branch = null;

    nameInput.value = '';
    nameInput.classList.remove('filled');

    // The popup opens on whichever tab is currently active on the Catalog
    // page (Products or Ingredients) -- not always Product.
    if (tabIngredients.classList.contains('active')) {
      showIngredientTab();
    } else {
      showProductTab();
    }

    // Frame 79: when the Ingredient tab is first shown, neither radio is selected.
    collapseSlot(unitSlot, radioUnitHeader, unitFields);
    collapseSlot(measurableSlot, radioMeasurableHeader, measurableFields);

    unitField.value = '';
    unitField.placeholder = 'I want to measure by';
    unitRow.classList.remove('chosen');
    totalField.value = '';
    amountField.value = '';
    roughField.value = '';
    bufferField.value = '10';
    amountRow.hidden = true;
    roughRow.hidden = true;
    bufferRow.hidden = true;
    costLabel.textContent = 'Cost per..';
    costValue.textContent = '$';
    costValue.classList.remove('has-value');

    updateCreateButton();
    resetProductTab();
  }

  function openAddModal() {
    resetModalState();
    modalAdd.classList.add('open');
  }

  function closeAddModal() {
    modalAdd.classList.remove('open');
    unitPicker.classList.remove('open');
  }

  btnOpenAdd.addEventListener('click', openAddModal);
  btnCancel.addEventListener('click', closeAddModal);

  nameInput.addEventListener('input', function () {
    nameInput.classList.toggle('filled', nameInput.value.trim().length > 0);
    updateCreateButton();
    // updateCreateButton() only ever gates the Create Ingredient button --
    // Create Product's readiness (which also depends on the name) is
    // recomputed inside renderVariations(), which otherwise only runs on
    // ingredient/hours changes, so typing a name alone never re-checked it.
    renderVariations();
  });

  /* Product / Ingredient filter pills.
     Frame 80 (Product) has no button at all -- that's the Create Product
     screen, not built yet -- so the Create Ingredient button only exists
     once the Ingredient tab (Frame 79/46/53...) is showing. */
  function showProductTab() {
    filterProduct.classList.add('active');
    filterIngredient.classList.remove('active');
    productTabContent.hidden = false;
    ingredientTabContent.hidden = true;
    btnCreate.hidden = true;
  }

  function showIngredientTab() {
    filterIngredient.classList.add('active');
    filterProduct.classList.remove('active');
    ingredientTabContent.hidden = false;
    productTabContent.hidden = true;
    btnCreate.hidden = false;
  }

  filterProduct.addEventListener('click', function () {
    showProductTab();
    updateCreateButton();
  });

  filterIngredient.addEventListener('click', function () {
    showIngredientTab();
    updateCreateButton();
  });

  /* Unit Item vs Measurable Item radios.
     Selecting one expands its slot into the header+fields box (Frame 53 /
     Frame 46); the other slot collapses back to a plain unselected row.
     Both start unselected (Frame 79) until the user taps one. */
  radioUnitHeader.addEventListener('click', function () {
    state.itemType = 'unit';
    unitSlot.classList.add('expanded');
    radioUnitHeader.classList.add('selected');
    unitFields.hidden = false;
    collapseSlot(measurableSlot, radioMeasurableHeader, measurableFields);
    updateCreateButton();
  });

  radioMeasurableHeader.addEventListener('click', function () {
    state.itemType = 'measurable';
    measurableSlot.classList.add('expanded');
    radioMeasurableHeader.classList.add('selected');
    measurableFields.hidden = false;
    collapseSlot(unitSlot, radioUnitHeader, unitFields);
    updateCreateButton();
  });

  /* Unit picker open/close */
  btnOpenUnitPicker.addEventListener('click', function () {
    unitPicker.classList.add('open');
  });
  unitRow.addEventListener('click', function () {
    unitPicker.classList.add('open');
  });
  btnCloseUnitPicker.addEventListener('click', function () {
    unitPicker.classList.remove('open');
  });

  unitList.addEventListener('click', function (e) {
    var li = e.target.closest('.unit-option');
    if (!li) return;
    var unit = li.dataset.unit;
    state.unit = unit;
    state.branch = unit === 'uses' ? 'rough' : 'granular';

    unitField.value = unit === 'uses' ? 'Uses' : unit;
    unitRow.classList.add('chosen');

    if (state.branch === 'rough') {
      amountRow.hidden = true;
      bufferRow.hidden = true;
      roughRow.hidden = false;
      costLabel.textContent = 'Cost per use';
    } else {
      roughRow.hidden = true;
      amountRow.hidden = false;
      bufferRow.hidden = false;
      costLabel.textContent = 'Cost per ' + unit;
    }

    unitPicker.classList.remove('open');
    recalcCost();
    updateCreateButton();
  });

  /* live cost calculation */
  function setCost(text, hasValue) {
    costValue.textContent = text;
    costValue.classList.toggle('has-value', !!hasValue);
  }

  function recalcCost() {
    var total = parseFloat(totalField.value);
    if (!state.unit || isNaN(total)) {
      setCost('$', false);
      return;
    }
    if (state.branch === 'rough') {
      var uses = parseFloat(roughField.value);
      if (!uses || uses <= 0) { setCost('$', false); return; }
      setCost('$' + round2(total / uses), true);
    } else {
      var amount = parseFloat(amountField.value);
      var buffer = parseFloat(bufferField.value);
      if (isNaN(buffer)) buffer = 0;
      if (!amount || amount <= 0) { setCost('$', false); return; }
      var usable = amount * (1 - buffer / 100);
      if (usable <= 0) { setCost('$', false); return; }
      setCost('$' + round2(total / usable), true);
    }
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  [totalField, amountField, roughField, bufferField].forEach(function (el) {
    el.addEventListener('input', function () {
      recalcCost();
      updateCreateButton();
    });
  });

  function updateCreateButton() {
    var ready = false;
    if (!ingredientTabContent.hidden && state.itemType === 'measurable') {
      var hasName = nameInput.value.trim().length > 0;
      var hasUnit = !!state.unit;
      var total = parseFloat(totalField.value);
      var hasTotal = !isNaN(total) && total > 0;
      var branchOk = false;
      if (state.branch === 'rough') {
        var uses = parseFloat(roughField.value);
        branchOk = !isNaN(uses) && uses > 0;
      } else if (state.branch === 'granular') {
        var amount = parseFloat(amountField.value);
        branchOk = !isNaN(amount) && amount > 0;
      }
      ready = hasName && hasUnit && hasTotal && branchOk;
    }
    btnCreate.classList.toggle('ready', ready);
    btnCreate.disabled = !ready;
  }

  /* functional scrollbar thumb for unit list */
  function updateScrollbar() {
    var track = scrollbarThumb.parentElement;
    var trackH = track.clientHeight;
    var contentH = unitList.scrollHeight;
    var visibleH = unitList.clientHeight;
    if (contentH <= visibleH) {
      scrollbarThumb.style.height = trackH + 'px';
      scrollbarThumb.style.top = '0px';
      return;
    }
    var thumbH = Math.max(24, (visibleH / contentH) * trackH);
    var maxTop = trackH - thumbH;
    var scrollRatio = unitList.scrollTop / (contentH - visibleH);
    scrollbarThumb.style.height = thumbH + 'px';
    scrollbarThumb.style.top = (scrollRatio * maxTop) + 'px';
  }
  unitList.addEventListener('scroll', updateScrollbar);
  window.addEventListener('resize', updateScrollbar);

  /* draggable thumb */
  (function enableDrag() {
    var dragging = false, startY = 0, startScroll = 0;
    scrollbarThumb.addEventListener('pointerdown', function (e) {
      dragging = true;
      startY = e.clientY;
      startScroll = unitList.scrollTop;
      scrollbarThumb.setPointerCapture(e.pointerId);
    });
    scrollbarThumb.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var track = scrollbarThumb.parentElement;
      var trackH = track.clientHeight;
      var contentH = unitList.scrollHeight;
      var visibleH = unitList.clientHeight;
      var deltaY = e.clientY - startY;
      var ratio = deltaY / (trackH - scrollbarThumb.offsetHeight);
      unitList.scrollTop = startScroll + ratio * (contentH - visibleH);
    });
    scrollbarThumb.addEventListener('pointerup', function () { dragging = false; });
    scrollbarThumb.addEventListener('pointercancel', function () { dragging = false; });
  })();

  /* ---------------- Create Ingredient ---------------- */
  btnCreate.addEventListener('click', function () {
    if (!btnCreate.classList.contains('ready')) return;

    var name = nameInput.value.trim();
    var unit = state.unit;
    var subText;
    if (state.branch === 'rough') {
      var uses = parseFloat(roughField.value);
      subText = uses + ' uses';
    } else {
      var amount = parseFloat(amountField.value);
      subText = amount + ' / ' + amount + ' ' + unit;
    }

    var li = document.createElement('li');
    li.className = 'item-card new-item';
    li.innerHTML =
      '<div><p class="item-name"></p><p class="item-sub"></p></div>' +
      '<span class="status-tag neutral">In Stock</span>';
    li.querySelector('.item-name').textContent = name;
    li.querySelector('.item-sub').textContent = subText;
    listIngredients.insertBefore(li, listIngredients.firstChild);

    tabIngredients.click();
    closeAddModal();
  });

  /* clicking outside the sheet content but still in the peek margin closes it too */
  unitPicker.addEventListener('click', function (e) {
    if (e.target === unitPicker) unitPicker.classList.remove('open');
  });

  /* ================= Create Product flow (Frames 64, 66-77) ================= */

  // "measurable" ingredients need a quantity (price = rate x qty).
  // "unit" ingredients are a flat one-time inclusion (fixed price, no quantity),
  // per confirmed rule: Unit Item ingredients -> flat row, Measurable Item -> expandable box.
  var INGREDIENT_CATALOG = [
    { name: 'Olive Green Leather', type: 'measurable', unit: 'sqft', rate: 11.73, stock: '4 / 12 sq ft', recent: true },
    { name: 'Zipper Tape', type: 'measurable', unit: 'ft', rate: 2.73, stock: '27 / 30 ft', recent: true },
    { name: 'Purple Leather', type: 'measurable', unit: 'sqft', rate: 2.73, stock: '2.75 / 12 sq ft' },
    { name: 'Brass Rivets', type: 'measurable', unit: 'unit', rate: 6, stock: '4 / 10', recent: true },
    { name: 'Light Brown Thread', type: 'unit', flatPrice: 2.29, stock: '37 / 50 ft' },
    { name: 'Glue', type: 'measurable', unit: 'ml', rate: 2.73, stock: '4 / 12 ml' },
    { name: 'Rope', type: 'measurable', unit: 'ft', rate: 2.73, stock: '8.5 / 20 ft' },
    { name: 'Bright Green Leather', type: 'measurable', unit: 'sqft', rate: 4.80, stock: '4 / 12 sq ft' },
    { name: 'Blue Leather', type: 'measurable', unit: 'sqft', rate: 7.39, stock: '10.5 / 12 sq ft' },
    { name: 'Burgundy Leather', type: 'measurable', unit: 'sqft', rate: 10, stock: '4 / 12 sq ft', recent: true },
    { name: 'Waxed Thread', type: 'measurable', unit: 'ft', rate: 0.35, stock: '45 / 100 ft' },
    { name: 'Snap Buttons', type: 'unit', flatPrice: 1.50, stock: '6 / 50' },
    { name: 'Edge Paint', type: 'measurable', unit: 'oz', rate: 4.00, stock: '0 / 8 oz' },
    { name: 'Leather Dye', type: 'measurable', unit: 'oz', rate: 3.50, stock: '3 / 10 oz' },
    { name: 'Contact Cement', type: 'measurable', unit: 'oz', rate: 1.20, stock: '12 / 16 oz' },
    { name: 'Beeswax', type: 'unit', flatPrice: 3.00, stock: '2 / 5 blocks' }
  ];

  function ingredientInStock(item) {
    var first = parseFloat(item.stock);
    return !isNaN(first) && first > 0;
  }

  var productVariations = []; // [{ label, ingredients: [{name,type,rate|flatPrice,unit,quantity}], hours, rate }]
  var pvContainer = document.getElementById('product-variations');
  var productEmptyRow = document.getElementById('product-empty-row');
  document.getElementById('product-add-ingredient-empty').addEventListener('click', function () {
    openIngredientPicker(0);
  });
  var productFooter = document.getElementById('product-footer');
  var btnAddVariation = document.getElementById('btn-add-variation');
  var btnSaveDraft = document.getElementById('btn-save-draft');
  var btnCreateProduct = document.getElementById('btn-create-product');

  function newVariation(index, source) {
    return {
      label: 'Variation ' + index,
      ingredients: source ? source.ingredients.map(function (i) { return Object.assign({}, i); }) : [],
      hours: source ? source.hours : null,
      rate: source ? source.rate : null
    };
  }

  function resetProductTab() {
    productVariations = [newVariation(1)];
    renderVariations();
  }

  function lineTotal(ing) {
    if (ing.type === 'unit') return ing.flatPrice;
    var q = parseFloat(ing.quantity);
    return !isNaN(q) && q > 0 ? q * ing.rate : null;
  }

  function variationCost(v) {
    var sum = 0;
    v.ingredients.forEach(function (ing) {
      var t = lineTotal(ing);
      if (t !== null) sum += t;
    });
    return sum;
  }

  function variationReady(v) {
    // Hours to Make (and its hourly rate) are explicitly optional -- the
    // sheet's own copy says so -- so they must not gate the Create Product
    // button. Only every ingredient needing a resolved quantity/price does.
    if (v.ingredients.length === 0) return false;
    return v.ingredients.every(function (ing) { return lineTotal(ing) !== null; });
  }

  function renderVariations() {
    pvContainer.innerHTML = '';
    var showLabels = productVariations.length > 1;

    productVariations.forEach(function (v, vIndex) {
      // Frame 64: before any ingredient has been added, there's no card at
      // all yet -- just the standalone empty "+ Add Ingredient" row handled
      // below. Only render a variation's own card once it has ingredients.
      if (v.ingredients.length === 0) return;

      var block = document.createElement('div');
      block.className = 'variation-block';

      if (showLabels) {
        var labelRow = document.createElement('div');
        labelRow.className = 'variation-label-row';
        labelRow.innerHTML =
          '<button class="chevron-btn variation-pencil"><img src="assets/icons/pencil.svg" alt=""></button>' +
          '<input class="variation-label" value="' + v.label + '" />';
        var labelInput = labelRow.querySelector('.variation-label');
        labelInput.addEventListener('input', function () { v.label = labelInput.value; });
        var pencilBtn = labelRow.querySelector('.variation-pencil');
        pencilBtn.addEventListener('click', function () { labelInput.focus(); labelInput.select(); });
        block.appendChild(labelRow);
      }

      v.ingredients.forEach(function (ing, ingIndex) {
        block.appendChild(renderIngredientRow(v, vIndex, ing, ingIndex));
      });

      // + Add Ingredient row. Figma metadata: icon slot (44) then text
      // starting 4px later (gap-4), not flush -- reuse the exact same
      // .simple-row/.row-left structure as the static Frame 64 row rather
      // than the generic .field-row (which has 0 gap here).
      var addRow = document.createElement('div');
      addRow.className = 'simple-row';
      addRow.innerHTML =
        '<div class="row-left">' +
          '<span class="icon-slot"><img src="assets/icons/add.svg" alt=""></span>' +
          '<span>Add Ingredient</span>' +
        '</div>' +
        '<button class="chevron-btn"><img src="assets/icons/caret-right.svg" alt=""></button>';
      addRow.addEventListener('click', function () { openIngredientPicker(vIndex); });
      block.appendChild(addRow);

      // Hours to make row
      var hoursRow = document.createElement('div');
      hoursRow.className = 'field-row hours-row';
      var hasHours = v.hours !== null && v.hours > 0;
      hoursRow.innerHTML =
        '<span class="icon-slot"><img src="assets/icons/stopwatch.svg" alt="" style="width:14px;height:16px"></span>' +
        '<span class="hours-input' + (hasHours ? ' filled' : '') + '">' +
          (hasHours ? v.hours.toFixed(1) + '<span class="hours-suffix">hours</span>' : 'Hours to make') +
        '</span>' +
        '<span class="spacer"></span>' +
        '<span class="info-slot"><img src="assets/icons/info.svg" alt=""></span>';
      hoursRow.querySelector('.hours-input').addEventListener('click', function () { openHoursSheet(vIndex); });
      block.appendChild(hoursRow);

      // Total display.
      // Figma shows the "Total cost..." placeholder for as long as ANY
      // ingredient still needs a quantity -- even if another ingredient in
      // the same list is a flat/unit item already contributing a real cost
      // (Frame 66 keeps "Total cost... $" even with Light Brown Thread's
      // $2.29 already in the list). It only switches to a real computed
      // "Total" once every ingredient resolves, matching the same
      // all-required condition the Create Product button uses.
      var totalRow = document.createElement('div');
      totalRow.className = 'total-display';
      var cost = variationCost(v);
      var allResolved = v.ingredients.length > 0 && v.ingredients.every(function (ing) { return lineTotal(ing) !== null; });
      if (!allResolved) {
        totalRow.innerHTML = '<span class="t-label">Total cost...</span><span class="t-muted">$</span>';
      } else if (hasHours && v.rate) {
        var labor = v.hours * v.rate;
        totalRow.innerHTML =
          '<span class="t-label">Total</span><span class="t-value">$' + cost.toFixed(2) + '</span>' +
          '<span class="t-label">+</span><span class="t-value">$' + v.rate + '/hr</span>' +
          '<span class="t-label">=</span><span class="t-value">$' + (cost + labor).toFixed(2) + '</span>';
      } else {
        totalRow.innerHTML = '<span class="t-label">Total</span><span class="t-value">$' + cost.toFixed(2) + '</span>';
      }
      block.appendChild(totalRow);

      pvContainer.appendChild(block);
    });

    productEmptyRow.hidden = productVariations.length > 0 && productVariations[0].ingredients.length > 0;
    var anyIngredients = productVariations.some(function (v) { return v.ingredients.length > 0; });
    productFooter.hidden = !anyIngredients;

    var allReady = anyIngredients && productVariations.every(variationReady) && nameInput.value.trim().length > 0;
    btnCreateProduct.classList.toggle('ready', allReady);
    btnCreateProduct.disabled = !allReady;
  }

  // Figma's qty/hours inputs hug whatever text they're showing rather than
  // sitting in a fixed-width box; a plain <input> won't auto-size to its
  // own value or placeholder, so measure it the same way a canvas-based
  // text-width check would and set the width explicitly.
  // A canvas-measured font can race the @import'd Poppins web font: measure
  // before it's loaded and you get a narrower fallback-font width baked into
  // the input's style, which then clips once Poppins actually paints wider
  // glyphs. A hidden span sized by the real DOM/CSS font pipeline can never
  // be out of sync with the input sitting right next to it, since both go
  // through the same font at the same time.
  var measureSpan = document.createElement('span');
  measureSpan.style.cssText = 'position:absolute; visibility:hidden; white-space:pre; top:-9999px; left:-9999px; font-family:"Poppins",sans-serif; font-size:16px;';
  document.body.appendChild(measureSpan);
  function measureTextWidth(text) {
    measureSpan.textContent = text;
    return measureSpan.getBoundingClientRect().width;
  }
  function sizeQtyInput(input) {
    var text = input.value || input.placeholder || '';
    input.style.width = (Math.ceil(measureTextWidth(text)) + 12 * 2 + 2) + 'px'; // + horizontal padding + border
  }
  // Same idea, but for an input with no padding/border of its own (e.g. one
  // sitting inside an already-padded box alongside a unit label).
  function sizeBareInput(input) {
    var text = input.value || input.placeholder || '';
    input.style.width = Math.ceil(measureTextWidth(text) + 4) + 'px';
  }

  function renderIngredientRow(v, vIndex, ing, ingIndex) {
    var row = document.createElement('div');
    if (ing.type === 'unit') {
      row.className = 'ingredient-editable flat';
      row.innerHTML =
        '<div class="ie-left">' +
          '<button class="ie-remove"><img src="assets/icons/x-small-dark.svg" alt=""></button>' +
          '<p class="ie-name">' + ing.name + '</p>' +
        '</div>' +
        '<p class="ie-line-total">$' + ing.flatPrice.toFixed(2) + '</p>';
    } else {
      var total = lineTotal(ing);
      row.className = 'ingredient-editable';
      var dataKey = 'v' + vIndex + '-i' + ingIndex;
      var qtyPlaceholder = ing.unit === 'unit' ? 'add units' : 'add quantity';
      row.innerHTML =
        '<div class="ie-header">' +
          '<p class="ie-name">' + ing.name + '</p>' +
          '<p class="ie-rate">$' + ing.rate + ' / ' + ing.unit + '</p>' +
        '</div>' +
        '<div class="ie-input-row">' +
          '<div class="ie-left">' +
            '<button class="ie-remove"><img src="assets/icons/x-small-dark.svg" alt=""></button>' +
            '<input class="ie-qty-input" data-key="' + dataKey + '" inputmode="decimal" placeholder="' + qtyPlaceholder + '" value="' + (ing.quantity || '') + '" />' +
          '</div>' +
          '<span class="ie-line-total">' + (total !== null ? '$' + total.toFixed(2) : '..') + '</span>' +
        '</div>';
      var qtyInput = row.querySelector('.ie-qty-input');
      sizeQtyInput(qtyInput);
      qtyInput.addEventListener('input', function () {
        ing.quantity = qtyInput.value;
        renderVariations();
        // restore focus after re-render (keyed by variation+ingredient index,
        // not DOM position -- flat/unit rows have no input, so a positional
        // index would drift as soon as one appears earlier in the list)
        var fresh = pvContainer.querySelector('.ie-qty-input[data-key="' + dataKey + '"]');
        if (fresh) { fresh.focus(); fresh.setSelectionRange(fresh.value.length, fresh.value.length); }
      });
    }
    row.querySelector('.ie-remove').addEventListener('click', function () {
      v.ingredients.splice(ingIndex, 1);
      renderVariations();
    });
    return row;
  }

  btnAddVariation.addEventListener('click', function () {
    var last = productVariations[productVariations.length - 1];
    productVariations.push(newVariation(productVariations.length + 1, last));
    renderVariations();
  });

  btnSaveDraft.addEventListener('click', function () {
    closeAddModal();
  });

  btnCreateProduct.addEventListener('click', function () {
    if (!btnCreateProduct.classList.contains('ready')) return;
    var name = nameInput.value.trim();
    var li = document.createElement('li');
    li.className = 'item-card new-item';
    li.innerHTML =
      '<div><p class="item-name"></p><p class="item-sub">Made to Order</p></div>' +
      '<span class="status-tag neutral">Available</span>';
    li.querySelector('.item-name').textContent = name;
    listProducts.insertBefore(li, listProducts.firstChild);
    tabProducts.click();
    closeAddModal();
  });

  /* ---------------- Ingredient picker ---------------- */
  var ingredientPickerModal = document.getElementById('ingredient-picker-modal');
  var ipList = document.getElementById('ip-list');
  var ipSearchInput = document.getElementById('ip-search-input');
  var ipClearSelection = document.getElementById('btn-clear-selection');
  var btnCloseIngredientPicker = document.getElementById('btn-close-ingredient-picker');
  var btnDoneIngredientPicker = document.getElementById('btn-done-ingredient-picker');
  var ipFilterChips = Array.prototype.slice.call(document.querySelectorAll('.filter-chip'));

  var ipTargetVariationIndex = 0;
  var ipSelected = {}; // name -> true

  function openIngredientPicker(vIndex) {
    ipTargetVariationIndex = vIndex;
    ipSelected = {};
    productVariations[vIndex].ingredients.forEach(function (ing) { ipSelected[ing.name] = true; });
    ipSearchInput.value = '';
    ipFilterChips.forEach(function (c) { c.classList.remove('active'); });
    renderIpList();
    ingredientPickerModal.classList.add('open');
  }

  function closeIngredientPicker() {
    ingredientPickerModal.classList.remove('open');
  }

  function activeChipKeys() {
    return ipFilterChips.filter(function (c) { return c.classList.contains('active'); }).map(function (c) { return c.dataset.chip; });
  }

  function renderIpList() {
    var query = ipSearchInput.value.trim().toLowerCase();
    var chips = activeChipKeys();
    var items = INGREDIENT_CATALOG.filter(function (item) {
      if (query && item.name.toLowerCase().indexOf(query) === -1) return false;
      for (var i = 0; i < chips.length; i++) {
        var chip = chips[i];
        if (chip === 'recent' && !item.recent) return false;
        if (chip === 'unit' && item.type !== 'unit') return false;
        if (chip === 'measurable' && item.type !== 'measurable') return false;
        if (chip === 'stock' && !ingredientInStock(item)) return false;
      }
      return true;
    });

    ipList.innerHTML = '';
    items.forEach(function (item) {
      var li = document.createElement('li');
      var isSelected = !!ipSelected[item.name];
      li.className = 'ip-row' + (isSelected ? ' selected' : '');
      var priceLabel = item.type === 'unit' ? ('$' + item.flatPrice.toFixed(2)) : ('$' + item.rate + ' / ' + item.unit);
      li.innerHTML =
        '<div class="ip-left">' +
          '<span class="ip-checkbox"></span>' +
          '<div class="ip-text"><p class="ip-name">' + item.name + '</p><p class="ip-stock">' + item.stock + '</p></div>' +
        '</div>' +
        '<span class="ip-price">' + priceLabel + '</span>';
      li.addEventListener('click', function () {
        if (ipSelected[item.name]) { delete ipSelected[item.name]; } else { ipSelected[item.name] = true; }
        renderIpList();
      });
      ipList.appendChild(li);
    });
  }

  ipSearchInput.addEventListener('input', renderIpList);
  ipFilterChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chip.classList.toggle('active');
      renderIpList();
    });
  });
  ipClearSelection.addEventListener('click', function () {
    ipSelected = {};
    renderIpList();
  });
  btnCloseIngredientPicker.addEventListener('click', closeIngredientPicker);
  btnDoneIngredientPicker.addEventListener('click', function () {
    var v = productVariations[ipTargetVariationIndex];
    var selectedNames = Object.keys(ipSelected);
    // remove ingredients that got unchecked
    v.ingredients = v.ingredients.filter(function (ing) { return ipSelected[ing.name]; });
    var existingNames = v.ingredients.map(function (i) { return i.name; });
    selectedNames.forEach(function (name) {
      if (existingNames.indexOf(name) !== -1) return;
      var catalogItem = INGREDIENT_CATALOG.filter(function (c) { return c.name === name; })[0];
      if (!catalogItem) return;
      v.ingredients.push(Object.assign({ quantity: '' }, catalogItem));
    });
    renderVariations();
    closeIngredientPicker();
  });
  ingredientPickerModal.addEventListener('click', function (e) {
    if (e.target === ingredientPickerModal) closeIngredientPicker();
  });
  enableDragScroll(ipList);

  /* ---------------- Hours to Make sheet ---------------- */
  var hoursSheetBackdrop = document.getElementById('hours-sheet-backdrop');
  var hoursRateInput = document.getElementById('hours-rate-input');
  var hoursValueInput = document.getElementById('hours-value-input');
  var hoursRateDollar = document.getElementById('hours-rate-dollar');
  var hoursRateUnit = document.getElementById('hours-rate-unit');
  var hoursValueUnit = document.getElementById('hours-value-unit');
  var btnCloseHoursSheet = document.getElementById('btn-close-hours-sheet');
  var btnSaveHours = document.getElementById('btn-save-hours');
  var hoursTargetVariationIndex = 0;

  function openHoursSheet(vIndex) {
    hoursTargetVariationIndex = vIndex;
    var v = productVariations[vIndex];
    hoursRateInput.value = v.rate || '';
    hoursValueInput.value = v.hours || '';
    updateHoursUnitLabels();
    updateSaveHoursState();
    hoursSheetBackdrop.classList.add('open');
  }

  function closeHoursSheet() {
    hoursSheetBackdrop.classList.remove('open');
  }

  // Figma: empty state is a single plain placeholder ("$USD" / "hours");
  // once a value exists it splits into value (left) + persistent unit
  // label (right, justify-between) -- matches the main screen's own
  // "Hours to make" row once it's filled in.
  function updateHoursUnitLabels() {
    var hasRate = hoursRateInput.value.trim().length > 0;
    var hasHours = hoursValueInput.value.trim().length > 0;
    hoursRateDollar.hidden = !hasRate;
    hoursRateUnit.hidden = !hasRate;
    hoursValueUnit.hidden = !hasHours;
  }

  function updateSaveHoursState() {
    var rate = parseFloat(hoursRateInput.value);
    var hours = parseFloat(hoursValueInput.value);
    var ready = !isNaN(rate) && rate > 0 && !isNaN(hours) && hours > 0;
    btnSaveHours.classList.toggle('ready', ready);
    btnSaveHours.disabled = !ready;
  }

  hoursRateInput.addEventListener('input', function () { updateHoursUnitLabels(); updateSaveHoursState(); });
  hoursValueInput.addEventListener('input', function () { updateHoursUnitLabels(); updateSaveHoursState(); });
  btnCloseHoursSheet.addEventListener('click', closeHoursSheet);
  hoursSheetBackdrop.addEventListener('click', function (e) {
    if (e.target === hoursSheetBackdrop) closeHoursSheet();
  });
  btnSaveHours.addEventListener('click', function () {
    if (!btnSaveHours.classList.contains('ready')) return;
    var v = productVariations[hoursTargetVariationIndex];
    v.rate = parseFloat(hoursRateInput.value);
    v.hours = parseFloat(hoursValueInput.value);
    closeHoursSheet();
    renderVariations();
  });

  nameInput.addEventListener('input', function () {
    if (!productTabContent.hidden) renderVariations();
  });

  resetProductTab();

  /* ================= Plan tab + "Plan for future orders" flow ================= */

  // Recipes are invented (the app has no real product/ingredient linkage yet)
  // but every quantity references a real, measurable INGREDIENT_CATALOG entry
  // so the shortfall math below is genuine, not just Figma's example numbers.
  var PRODUCT_CATALOG = [
    { name: 'Messenger Bag', sub: 'Made to Order', tag: 'available', recipe: [
      { ingredient: 'Blue Leather', qty: 3 }, { ingredient: 'Brass Rivets', qty: 6 }, { ingredient: 'Waxed Thread', qty: 5 }
    ] },
    { name: 'Vertical Wallet', sub: '7 in stock', tag: 'in-stock', recipe: [
      { ingredient: 'Olive Green Leather', qty: 0.5 }, { ingredient: 'Waxed Thread', qty: 3 }, { ingredient: 'Brass Rivets', qty: 4 }
    ] },
    { name: 'Horizontal Wallet', sub: 'Made to Order', tag: 'at-risk', recipe: [
      { ingredient: 'Olive Green Leather', qty: 0.6 }, { ingredient: 'Waxed Thread', qty: 2.5 }, { ingredient: 'Brass Rivets', qty: 4 }
    ] },
    { name: 'Passport Holder', sub: '0 in stock', tag: 'restock', recipe: [
      { ingredient: 'Bright Green Leather', qty: 0.4 }, { ingredient: 'Brass Rivets', qty: 2 }, { ingredient: 'Waxed Thread', qty: 1.5 }
    ] },
    { name: 'Brass Keychain', sub: '7 in stock', tag: 'in-stock', recipe: [
      { ingredient: 'Blue Leather', qty: 0.2 }, { ingredient: 'Brass Rivets', qty: 2 }
    ] },
    { name: 'Leather Tote Bag', sub: '3 in stock', tag: 'in-stock', recipe: [
      { ingredient: 'Purple Leather', qty: 4 }, { ingredient: 'Rope', qty: 1 }, { ingredient: 'Waxed Thread', qty: 6 }
    ] },
    { name: 'Card Holder', sub: '15 in stock', tag: 'in-stock', recipe: [
      { ingredient: 'Burgundy Leather', qty: 0.3 }, { ingredient: 'Waxed Thread', qty: 1 }
    ] },
    { name: 'Leather Belt', sub: 'Made to Order', tag: 'at-risk', recipe: [
      { ingredient: 'Burgundy Leather', qty: 0.8 }, { ingredient: 'Contact Cement', qty: 0.5 }
    ] },
    { name: 'Zip Pouch', sub: '9 in stock', tag: 'in-stock', recipe: [
      { ingredient: 'Purple Leather', qty: 0.5 }, { ingredient: 'Zipper Tape', qty: 1 }, { ingredient: 'Waxed Thread', qty: 1 }
    ] }
  ];

  var PF_TAG_LABEL = { 'in-stock': 'In Stock', 'restock': 'Restock', 'available': 'Available', 'at-risk': 'At Risk' };
  var PF_TAG_CLASS = { 'in-stock': 'neutral', 'restock': 'alert', 'available': 'neutral', 'at-risk': 'low' };

  function unitLabel(unit) {
    if (unit === 'sqft') return 'sq ft';
    if (unit === 'unit') return 'units';
    return unit;
  }

  var planCardsTop = document.getElementById('plan-cards-top');
  var planFlowModal = document.getElementById('plan-flow-modal');
  var pfStepSelect = document.getElementById('pf-step-select');
  var pfStepEdit = document.getElementById('pf-step-edit');
  var pfProductList = document.getElementById('pf-product-list');
  var pfSearchInput = document.getElementById('pf-search-input');
  var btnPfClearSelection = document.getElementById('btn-pf-clear-selection');
  var btnPfNext = document.getElementById('btn-pf-next');
  var pfSelectionLines = document.getElementById('pf-selection-lines');
  var pfIngredientList = document.getElementById('pf-ingredient-list');
  var btnPfEditSelection = document.getElementById('btn-pf-edit-selection');
  var btnPfSave = document.getElementById('btn-pf-save');

  var pfSelected = {}; // product name -> quantity (string, as typed)
  var pfNeeds = [];    // computed on entering step 2: [{ingredient, unit, rate, needMore, isUnit}]
  var lastPurchaseList = null; // {lines: [{name, qty}]} once saved

  function pfOpen() {
    pfSelected = {};
    pfSearchInput.value = '';
    pfRenderProductList();
    pfStepEdit.hidden = true;
    pfStepSelect.hidden = false;
    planFlowModal.classList.add('open');
  }

  function pfClose() {
    planFlowModal.classList.remove('open');
  }

  function pfRenderProductList() {
    var query = pfSearchInput.value.trim().toLowerCase();
    pfProductList.innerHTML = '';
    PRODUCT_CATALOG.filter(function (p) { return !query || p.name.toLowerCase().indexOf(query) !== -1; })
      .forEach(function (p) {
        var isSelected = Object.prototype.hasOwnProperty.call(pfSelected, p.name);
        var li = document.createElement('li');
        li.className = 'pf-product-card' + (isSelected ? ' selected' : '');
        var subClass = 'pf-product-sub' + (p.tag === 'restock' ? ' alert' : '');
        li.innerHTML =
          '<div class="pf-product-card-top">' +
            '<div class="pf-product-card-left">' +
              '<span class="pf-checkbox"></span>' +
              '<div class="pf-product-text"><p class="pf-product-name">' + p.name + '</p><p class="' + subClass + '">' + p.sub + '</p></div>' +
            '</div>' +
            '<span class="status-tag ' + PF_TAG_CLASS[p.tag] + '">' + PF_TAG_LABEL[p.tag] + '</span>' +
          '</div>' +
          (isSelected ?
            '<div class="pf-qty-row">' +
              '<span class="icon-slot"><img src="assets/icons/number-pad.svg" alt=""></span>' +
              '<input class="pf-qty-input" data-key="' + p.name + '" inputmode="numeric" value="' + pfSelected[p.name] + '" />' +
            '</div>' : '');
        li.querySelector('.pf-product-card-top').addEventListener('click', function () {
          if (isSelected) { delete pfSelected[p.name]; } else { pfSelected[p.name] = '1'; }
          pfRenderProductList();
        });
        var qtyInput = li.querySelector('.pf-qty-input');
        if (qtyInput) {
          qtyInput.addEventListener('click', function (e) { e.stopPropagation(); });
          qtyInput.addEventListener('input', function () {
            pfSelected[p.name] = qtyInput.value;
            btnPfNext.classList.toggle('ready', pfHasValidSelection());
            btnPfNext.disabled = !pfHasValidSelection();
            sizeQtyInput(qtyInput);
          });
          sizeQtyInput(qtyInput);
        }
        pfProductList.appendChild(li);
      });
    btnPfNext.classList.toggle('ready', pfHasValidSelection());
    btnPfNext.disabled = !pfHasValidSelection();
  }

  function pfHasValidSelection() {
    var names = Object.keys(pfSelected);
    if (names.length === 0) return false;
    return names.every(function (n) { var q = parseFloat(pfSelected[n]); return !isNaN(q) && q > 0; });
  }

  function pfComputeNeeds() {
    var totals = {}; // ingredient name -> total qty needed
    Object.keys(pfSelected).forEach(function (productName) {
      var qty = parseFloat(pfSelected[productName]);
      if (isNaN(qty) || qty <= 0) return;
      var product = PRODUCT_CATALOG.find(function (p) { return p.name === productName; });
      if (!product) return;
      product.recipe.forEach(function (line) {
        totals[line.ingredient] = (totals[line.ingredient] || 0) + line.qty * qty;
      });
    });
    var needs = [];
    Object.keys(totals).forEach(function (ingName) {
      var ing = INGREDIENT_CATALOG.find(function (i) { return i.name === ingName; });
      if (!ing) return;
      var have = parseFloat(ing.stock) || 0;
      var shortfall = totals[ingName] - have;
      if (shortfall <= 0) return;
      needs.push({
        ingredient: ingName,
        unit: ing.unit,
        rate: ing.rate,
        have: have,
        needMore: Math.round(shortfall * 100) / 100
      });
    });
    return needs;
  }

  function pfRenderSelectionSummary() {
    pfSelectionLines.innerHTML = '';
    Object.keys(pfSelected).forEach(function (name) {
      var line = document.createElement('div');
      line.className = 'pf-selection-line';
      line.innerHTML = '<span>' + name + ':</span><span>' + pfSelected[name] + '</span>';
      pfSelectionLines.appendChild(line);
    });
  }

  function pfRenderIngredientList() {
    pfIngredientList.innerHTML = '';
    pfNeeds.forEach(function (need, i) {
      var li = document.createElement('li');
      li.className = 'pf-ingredient-row';
      var cost = need.needMore * need.rate;
      li.innerHTML =
        '<div class="pf-ingredient-head">' +
          '<p class="pf-ingredient-name">' + need.ingredient + '</p>' +
          '<p class="pf-ingredient-have">You have ' + need.have + (need.unit === 'unit' ? '' : ' ' + unitLabel(need.unit)) + '</p>' +
        '</div>' +
        '<div class="pf-ingredient-input-row">' +
          '<div class="pf-ingredient-left">' +
            '<div class="icon-slot"><span class="pf-checkbox selected"></span></div>' +
            '<div class="pf-need-box">' +
              '<input type="text" inputmode="decimal" data-index="' + i + '" value="' + need.needMore + '" />' +
              '<span class="pf-need-unit">more ' + unitLabel(need.unit) + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="pf-ingredient-cost">$' + cost.toFixed(2) + '</span>' +
        '</div>';
      var input = li.querySelector('input');
      sizeBareInput(input);
      input.addEventListener('input', function () {
        var q = parseFloat(input.value);
        need.needMore = isNaN(q) ? 0 : q;
        li.querySelector('.pf-ingredient-cost').textContent = '$' + (need.needMore * need.rate).toFixed(2);
        sizeBareInput(input);
      });
      pfIngredientList.appendChild(li);
    });
  }

  btnPfNext.addEventListener('click', function () {
    if (!btnPfNext.classList.contains('ready')) return;
    pfNeeds = pfComputeNeeds();
    pfRenderSelectionSummary();
    pfRenderIngredientList();
    pfStepSelect.hidden = true;
    pfStepEdit.hidden = false;
  });

  btnPfEditSelection.addEventListener('click', function () {
    pfRenderProductList();
    pfStepEdit.hidden = true;
    pfStepSelect.hidden = false;
  });

  btnPfSave.addEventListener('click', function () {
    lastPurchaseList = {
      lines: Object.keys(pfSelected).map(function (name) { return { name: name, qty: pfSelected[name] }; })
    };
    pfClose();
    renderPlanCardsTop();
  });

  pfSearchInput.addEventListener('input', pfRenderProductList);
  btnPfClearSelection.addEventListener('click', function () { pfSelected = {}; pfRenderProductList(); });
  document.getElementById('btn-close-pf').addEventListener('click', pfClose);
  document.getElementById('btn-close-pf-2').addEventListener('click', pfClose);

  document.getElementById('plan-cards-top').addEventListener('click', function (e) {
    if (e.target.closest('#btn-open-plan-flow')) pfOpen();
  });

  function renderPlanCardsTop() {
    if (!lastPurchaseList) {
      planCardsTop.innerHTML =
        '<div class="plan-card plan-card-clickable" id="btn-open-plan-flow">' +
          '<div class="plan-card-header">' +
            '<p class="plan-card-title">Plan for future orders</p>' +
            '<span class="plan-card-cta"><span>Start</span><img src="assets/icons/arrow-right.svg" alt=""></span>' +
          '</div>' +
          '<p class="plan-card-desc">Select what you\'re planning to make and we\'ll put a shopping list together for you.</p>' +
        '</div>';
    } else {
      var lines = lastPurchaseList.lines.map(function (l) {
        return '<div class="plan-card-line"><span>' + l.name + ':</span><span>' + l.qty + '</span></div>';
      }).join('');
      planCardsTop.innerHTML =
        '<div class="plan-card">' +
          '<div class="plan-card-header">' +
            '<p class="plan-card-title">Last Purchase List</p>' +
            '<span class="plan-card-cta"><span>View &amp; edit</span><img src="assets/icons/arrow-right.svg" alt=""></span>' +
          '</div>' +
          '<div class="plan-card-lines">' + lines + '</div>' +
        '</div>';
    }
  }

  renderPlanCardsTop();

})();
