import React from 'react';
import './SalesStation.css';

/** Sale-station UI; the parent owns the local order draft and existing POS actions. */
export default function SalesStation({ V }) {
  const searchRef = React.useRef(null);
  const productRefs = React.useRef([]);
  const cartRef = React.useRef(null);
  const [mobileCartOpen, setMobileCartOpen] = React.useState(false);
  const visibleProducts = V.prods;

  React.useEffect(() => {
    function onKeyDown(event) {
      const target = event.target;
      const typing = target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      );
      if ((event.key === '/' && !typing) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key === 'Escape') {
        if (V.ed) {
          event.preventDefault();
          V.edCancel();
        } else if (mobileCartOpen) {
          setMobileCartOpen(false);
        } else if (V.search) {
          V.setSearch({ target: { value: '' } });
          searchRef.current?.focus();
        }
        return;
      }
      if (event.key === 'Enter' && target === searchRef.current && visibleProducts.length > 0) {
        event.preventDefault();
        visibleProducts[0].open();
        return;
      }
      if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault();
        setMobileCartOpen(true);
        cartRef.current?.querySelector('button, input')?.focus();
        return;
      }
      if (V.ed || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const current = target instanceof HTMLElement ? Number(target.dataset.productIndex) : NaN;
      const fromSearch = target === searchRef.current;
      if (!fromSearch && !Number.isInteger(current)) return;
      event.preventDefault();
      const next = event.key === 'ArrowDown'
        ? (fromSearch ? 0 : Math.min(visibleProducts.length - 1, current + 1))
        : (fromSearch ? -1 : Math.max(-1, current - 1));
      if (next < 0) searchRef.current?.focus();
      else productRefs.current[next]?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [V.ed, V.search, V.setSearch, V.edCancel, visibleProducts.length, mobileCartOpen]);

  return (
    <section className={'sales-station' + (mobileCartOpen ? ' sales-station--cart-first' : '')} aria-label="Estación de venta">
      <button
        className="sales-mobile-cart-toggle"
        type="button"
        onClick={() => setMobileCartOpen((open) => !open)}
        aria-expanded={mobileCartOpen}
        aria-controls="sales-cart"
      >
        <span>Orden · {V.itemCount} artículos</span>
        <strong>{V.total}</strong>
        <span aria-hidden="true">{mobileCartOpen ? '−' : '+'}</span>
      </button>

      <div className="sales-catalog">
        <label className="sales-search-label" htmlFor="sales-product-search">Buscar producto</label>
        <input
          ref={searchRef}
          id="sales-product-search"
          type="search"
          value={V.search}
          onChange={V.setSearch}
          placeholder="Buscar producto…"
          className="sales-search-input"
          autoComplete="off"
        />
        <p className="sales-keyboard-hint">Teclado: / o Ctrl+K para buscar · ↑ ↓ para recorrer · Enter para abrir · Esc para volver</p>

        <nav className="sales-categories" aria-label="Categorías del menú">
          {V.cats.map((category) => (
            <button key={category.label} type="button" className="sales-category-button" style={category.style} onClick={category.pick}>
              {category.label}
            </button>
          ))}
        </nav>

        {V.prodsEmpty ? (
          <div className="sales-empty" role="status">Sin resultados para esta búsqueda.<br />Prueba con otro nombre o cambia de categoría.</div>
        ) : (
          <div className="sales-products" role="list" aria-label={visibleProducts.length + ' productos'} style={V.gridStyle}>
            {visibleProducts.map((product, index) => (
              <button
                key={product.id || product.name + '-' + index}
                ref={(element) => { productRefs.current[index] = element; }}
                type="button"
                className="sales-product-card"
                style={product.style}
                data-product-index={index}
                aria-disabled={product.unavailable || undefined}
                aria-label={product.name + ', ' + product.price + (product.unavailable ? ', agotado' : '')}
                onClick={product.open}
              >
                <span className="sales-product-name">{product.name}</span>
                <span className="sales-product-meta">
                  <span>{product.price}</span>
                  {product.unavailable && <span className="sales-unavailable">Agotado</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <aside
        id="sales-cart"
        ref={cartRef}
        className={'sales-cart' + (mobileCartOpen ? ' sales-cart--open' : '')}
        aria-label="Orden actual"
      >
        <div className="sales-cart-heading">
          <span>Orden actual</span>
          {V.hasFolio && <span className="sales-folio">{V.orderFolio}</span>}
        </div>
        <div className="sales-order-types">
          {V.typeBtns.map((type) => (
            <button key={type.label} type="button" className="sales-type-button" style={type.style} onClick={type.pick}>{type.label}</button>
          ))}
        </div>
        {V.showMesa && (
          <label className="sales-field">
            <span>Número de mesa</span>
            <input value={V.mesa} onChange={V.setMesa} placeholder="Número de mesa" inputMode="numeric" />
          </label>
        )}
        <label className="sales-field">
          <span>Nombre o referencia</span>
          <input value={V.orderName} onChange={V.setOrderName} placeholder="Opcional" />
        </label>

        {V.linesEmpty ? (
          <div className="sales-empty sales-cart-empty">Sin productos.<br />Toca un producto del catálogo para agregarlo.</div>
        ) : (
          <div className="sales-lines" aria-label="Partidas">
            {V.lines.map((line) => (
              <div className="sales-line" key={line.lineId}>
                <div className="sales-quantity-controls" aria-label={'Cantidad de ' + line.name}>
                  <button type="button" onClick={line.dec} aria-label={'Disminuir ' + line.name}>−</button>
                  <span aria-live="polite">{line.qty}</span>
                  <button type="button" onClick={line.inc} aria-label={'Aumentar ' + line.name}>+</button>
                </div>
                <div className="sales-line-details">
                  <div className="sales-line-name">{line.name}</div>
                  {line.hasMods && <div className="sales-line-meta">{line.modsText}</div>}
                  {line.hasNotes && <div className="sales-line-notes">“{line.notes}”</div>}
                  <button type="button" className="sales-text-button" onClick={line.edit}>Editar partida</button>
                </div>
                <div className="sales-line-price">
                  <span>{line.total}</span>
                  <button type="button" onClick={line.remove} aria-label={'Eliminar ' + line.name} title="Eliminar">×</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="sales-totals">
          <div><span>Subtotal · {V.itemCount} art.</span><span>{V.subtotal}</span></div>
          {V.hasDiscount && <div className="sales-discount"><span>Descuento</span><span>−{V.discount}</span></div>}
          <button type="button" className="sales-text-button" onClick={V.addDiscount}>+ Agregar descuento</button>
          <div className="sales-total"><span>Total</span><strong>{V.total}</strong></div>
          <small>La propina se captura en el cobro.</small>
        </div>
        <div className="sales-actions">
          <button type="button" className="sales-secondary-action" onClick={V.saveOpen}>Guardar cuenta</button>
          <button type="button" className="sales-secondary-action" onClick={V.sendComanda}>Enviar comanda</button>
          <button type="button" className="sales-secondary-action sales-cancel-action" onClick={V.cancelOrder}>Cancelar orden</button>
          <button type="button" className="sales-charge-action" style={V.chargeStyle} onClick={V.goCharge}>Cobrar {V.total}</button>
        </div>
      </aside>
    </section>
  );
}
