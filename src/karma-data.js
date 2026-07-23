(function () {
  const mk = (cat, price, mods, names) => names.map(n => ({
    id: (cat + '-' + n).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: n, cat, price: Array.isArray(n) ? n[1] : price, mods: mods || [], available: true
  }));
  const mkp = (cat, mods, pairs) => pairs.map(([n, p]) => ({
    id: (cat + '-' + n).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: n, cat, price: p, mods: mods || [], available: true
  }));

  const categories = [
    { id: 'concafe', label: 'Con café' },
    { id: 'lattes', label: 'Lattes' },
    { id: 'frappes', label: 'Frappés' },
    { id: 'sodas', label: 'Sodas' },
    { id: 'magnolias', label: 'Magnolias' },
    { id: 'te', label: 'Té / Tisanas' },
    { id: 'salados', label: 'Salados' },
    { id: 'crepas', label: 'Crepas' },
    { id: 'postres', label: 'Postres' }
  ];

  const products = [
    ...mkp('concafe', ['leche', 'shot'], [['Americano', 50], ['Americano honey', 55], ['Capuchino', 60], ['Espresso', 30], ['Espresso tonic', 55], ['Cold brew', 60]]),
    ...mk('lattes', 65, ['leche', 'shot'], ['Latte café', 'Latte cajeta', 'Latte chai', 'Latte chocolate', 'Latte chocolate blanco', 'Latte chocomenta', 'Latte fresas con crema', 'Latte matcha', 'Latte moka', 'Latte nutella', 'Latte oreo', 'Latte ube', 'Latte taro']),
    ...mk('frappes', 75, ['leche', 'shot'], ['Frappé biscoff', 'Frappé café', 'Frappé cajeta', 'Frappé caramel macchiato', 'Frappé chai', 'Frappé chocolate', 'Frappé chocolate blanco', 'Frappé chocomenta', 'Frappé fresas con crema', 'Frappé frutos rojos', 'Frappé mango', 'Frappé matcha', 'Frappé moka', 'Frappé nutella', 'Frappé oreo', 'Frappé ube', 'Frappé taro', 'Frappé vainilla francesa']),
    ...mk('sodas', 55, [], ['Soda frutos rojos', 'Soda granada', 'Soda kiwi', 'Soda lavander bloom', 'Soda mango', 'Soda moras', 'Soda paraíso', 'Limonada', 'Limonada escarlata', 'Naranjada']),
    ...mk('magnolias', 65, [], ['Magnolia frutos rojos', 'Magnolia mango', 'Magnolia lavander green', 'Magnolia naranja']),
    ...mkp('te', null, [['Té', 45], ['Tisana', 55]]),
    ...mkp('salados', ['aderezo'], [['Croissant arrachera', 80], ['Croissant jamón con queso', 70], ['Croissant pollo', 70], ['Croissant quesos', 70], ['Croissant italiano', 70], ['Croissant club', 70], ['Emparedado huevo con tocino', 70]]),
    ...mkp('salados', null, [['Bowl de frutas', 55], ['Ensalada', 55]]),
    ...mkp('crepas', ['aderezo'], [['Crepa arrachera', 70], ['Crepa jamón con queso', 60], ['Crepa pollo', 60], ['Crepa quesos', 60], ['Crepa italiana', 60], ['Crepa hawaiana', 60], ['Crepa chicken hawaiana', 60]]),
    ...mkp('postres', null, [['Carlota', 32], ['Brownie', 38], ['Muffin', 30], ['Pastel del día', 45], ['Strudels (2 pz)', 45], ['Helado', 45], ['Crepa dulce', 50], ['Croissant dulce', 60], ['Affogato', 65]])
  ];
  const byName = n => products.find(p => p.name === n);
  byName('Té').mods = ['teVar'];
  byName('Tisana').mods = ['tisanaVar'];
  byName('Bowl de frutas').mods = ['topBowl'];
  byName('Ensalada').mods = ['proteina', 'aderezo'];
  byName('Helado').mods = ['dulceExtra'];
  byName('Crepa dulce').mods = ['crepaSabor', 'extraTop', 'dulceExtra'];
  byName('Croissant dulce').mods = ['croiSabor', 'frutaAcomp'];
  byName('Affogato').mods = ['affVar'];
  byName('Strudels (2 pz)').available = false;
  byName('Magnolia naranja').available = false;
  byName('Latte ube').available = false;

  const O = (names, price) => names.map(n => ({ id: n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: n, price: price || 0 }));
  const modGroups = {
    leche: { label: 'Tipo de leche', min: 1, max: 1, options: [{ id: 'entera', label: 'Entera', price: 0 }, ...O(['Deslactosada', 'Coco', 'Almendras', 'Avena'], 10)] },
    shot: { label: 'Shot de sabor', min: 0, max: 8, options: O(['Amareto', 'Avellana', 'Caramelo', 'Vainilla', 'Chai', 'Chocolate', 'Crema irlandesa', 'Vainilla francesa'], 10) },
    teVar: { label: 'Variedad', min: 1, max: 1, options: O(['Té negro', 'Té verde', 'Té rojo']) },
    tisanaVar: { label: 'Variedad', min: 1, max: 1, options: O(['Cosecha primaveral', 'La vie en rose', 'Paraíso azul', 'Notas doradas', 'Verde amanecer']) },
    aderezo: { label: 'Aderezos', min: 0, max: 6, options: O(['Ketchup', 'Mostaza miel', 'Miel', 'Ranch', 'Mil islas', 'Chipotle'], 10) },
    topBowl: { label: 'Topping incluido', min: 1, max: 1, options: O(['Almendra fileteada', 'Ajonjolí tostado', 'Granola']) },
    proteina: { label: 'Proteína', min: 1, max: 1, options: O(['Pollo', 'Queso panela', 'Jamón de pavo']) },
    dulceExtra: { label: 'Extras', min: 0, max: 4, options: [{ id: 'bola-helado', label: 'Bola de helado', price: 13 }, { id: 'philadelphia', label: 'Queso Philadelphia', price: 13 }, { id: 'crema-batida', label: 'Crema batida', price: 13 }, { id: 'fruta-extra', label: 'Fruta', price: 10 }] },
    affVar: { label: 'Variedad', min: 1, max: 1, options: O(['Tradicional', 'Moka', 'Matcha']) },
    crepaSabor: { label: 'Sabor', min: 1, max: 1, options: O(['Biscoff', 'Cajeta', 'Crema de cacahuate', 'Durazno con Philadelphia', 'Lechera', 'Mermelada de fresa', 'Mermelada de frutos rojos', 'Zarzamora con queso', 'Nutella', 'PB&J']) },
    croiSabor: { label: 'Sabor', min: 1, max: 1, options: O(['Biscoff', 'Crema de cacahuate', 'Mermelada de fresa', 'Mermelada de frutos rojos', 'Zarzamora con queso', 'Nutella']) },
    frutaAcomp: { label: 'Fruta que acompaña', min: 1, max: 1, options: O(['Durazno', 'Fresa', 'Plátano', 'Manzana']) },
    extraTop: { label: 'Toppings extra', min: 0, max: 6, options: O(['Almendras fileteadas', 'Amaranto', 'Chocolate', 'Granola', 'Lotus', 'Oreo'], 10) }
  };

  const users = [
    { id: 'u1', name: 'Marcela Ortiz', role: 'dueno', pin: '1111', active: true },
    { id: 'u2', name: 'Iván Cabrera', role: 'encargado', pin: '2222', active: true },
    { id: 'u3', name: 'Sofía Delgado', role: 'cajero', pin: '3333', active: true },
    { id: 'u4', name: 'Diego Rentería', role: 'cajero', pin: '4444', active: false },
    { id: 'u5', name: 'Rubí Méndez', role: 'cocina', pin: '5555', active: true }
  ];
  const roleLabels = { dueno: 'Dueña', encargado: 'Encargado', cajero: 'Cajero / barista', cocina: 'Cocina / barra' };

  const inventory = [
    { id: 'i1', name: 'Café en grano', kind: 'Ingrediente', qty: 6.5, unit: 'kg', min: 3 },
    { id: 'i2', name: 'Leche entera', kind: 'Ingrediente', qty: 18, unit: 'L', min: 10 },
    { id: 'i3', name: 'Leche de avena', kind: 'Ingrediente', qty: 4, unit: 'L', min: 6 },
    { id: 'i4', name: 'Matcha ceremonial', kind: 'Ingrediente', qty: 0.4, unit: 'kg', min: 0.5 },
    { id: 'i5', name: 'Concentrado de chai', kind: 'Ingrediente', qty: 3, unit: 'L', min: 2 },
    { id: 'i6', name: 'Croissant', kind: 'Producto terminado', qty: 24, unit: 'pz', min: 12 },
    { id: 'i7', name: 'Jamón de pavo', kind: 'Ingrediente', qty: 2.2, unit: 'kg', min: 1 },
    { id: 'i8', name: 'Fresas', kind: 'Ingrediente', qty: 2, unit: 'kg', min: 3 },
    { id: 'i9', name: 'Nutella', kind: 'Ingrediente', qty: 1.8, unit: 'kg', min: 1 },
    { id: 'i10', name: 'Vasos 12 oz', kind: 'Insumo', qty: 320, unit: 'pz', min: 150 },
    { id: 'i11', name: 'Vasos 16 oz', kind: 'Insumo', qty: 140, unit: 'pz', min: 150 },
    { id: 'i12', name: 'Brownie', kind: 'Producto terminado', qty: 9, unit: 'pz', min: 6 }
  ];

  const movements = [
    { id: 'm1', tipo: 'entrada', item: 'Leche entera', qty: '+12 L', user: 'Iván Cabrera', date: 'Hoy · 08:05', motivo: 'Compra proveedor Lácteos del Valle' },
    { id: 'm2', tipo: 'venta', item: 'Café en grano', qty: '−0.35 kg', user: 'Sistema', date: 'Hoy · 10:40', motivo: 'Descuento por ventas del turno' },
    { id: 'm3', tipo: 'merma', item: 'Fresas', qty: '−0.6 kg', user: 'Sofía Delgado', date: 'Hoy · 11:02', motivo: 'Fruta en mal estado' },
    { id: 'm4', tipo: 'entrada', item: 'Croissant', qty: '+30 pz', user: 'Iván Cabrera', date: 'Ayer · 07:50', motivo: 'Producción de panadería' },
    { id: 'm5', tipo: 'ajuste', item: 'Vasos 16 oz', qty: '−8 pz', user: 'Marcela Ortiz', date: 'Ayer · 19:20', motivo: 'Conteo físico de cierre' },
    { id: 'm6', tipo: 'venta', item: 'Leche entera', qty: '−4.1 L', user: 'Sistema', date: 'Ayer · 21:00', motivo: 'Descuento por ventas del día' },
    { id: 'm7', tipo: 'merma', item: 'Brownie', qty: '−2 pz', user: 'Rubí Méndez', date: '16 jul · 17:15', motivo: 'Pieza quebrada en exhibición' },
    { id: 'm8', tipo: 'entrada', item: 'Matcha ceremonial', qty: '+0.5 kg', user: 'Iván Cabrera', date: '15 jul · 09:30', motivo: 'Compra proveedor Kyoto MX' }
  ];

  const recipes = [
    { id: 'r1', product: 'Latte café', items: [['Café en grano', '18 g', '0.018 kg'], ['Leche entera', '240 ml', '0.24 L'], ['Vasos 12 oz', '1 pz', '1 pz']] },
    { id: 'r2', product: 'Capuchino', items: [['Café en grano', '18 g', '0.018 kg'], ['Leche entera', '160 ml', '0.16 L'], ['Vasos 12 oz', '1 pz', '1 pz']] },
    { id: 'r3', product: 'Latte matcha', items: [['Matcha ceremonial', '4 g', '0.004 kg'], ['Leche entera', '260 ml', '0.26 L'], ['Vasos 16 oz', '1 pz', '1 pz']] },
    { id: 'r4', product: 'Croissant jamón con queso', items: [['Croissant', '1 pz', '1 pz'], ['Jamón de pavo', '60 g', '0.06 kg']] },
    { id: 'r5', product: 'Crepa dulce · Nutella', items: [['Nutella', '45 g', '0.045 kg']] }
  ];

  const sales = [
    { folio: 'A-1047', day: 0, fecha: 'Hoy · 12:41', creo: 'Sofía Delgado', cobro: 'Sofía Delgado', tipo: 'Para llevar', items: [{ name: 'Latte matcha', qty: 1, mods: 'Avena', total: 75 }, { name: 'Croissant dulce', qty: 1, mods: 'Nutella · Fresa', total: 60 }], payments: [{ method: 'Tarjeta', amount: 148.5 }], tip: 13.5, total: 148.5, status: 'completada', sync: 'pendiente', audit: [['12:38', 'Orden creada', 'Sofía Delgado'], ['12:39', 'Comanda enviada', 'Sofía Delgado'], ['12:41', 'Cobro con tarjeta', 'Sofía Delgado'], ['12:41', 'Pendiente de sincronizar', 'Sistema']] },
    { folio: 'A-1046', day: 0, fecha: 'Hoy · 11:58', creo: 'Sofía Delgado', cobro: 'Iván Cabrera', tipo: 'Mesa 2', items: [{ name: 'Americano', qty: 2, mods: '', total: 100 }, { name: 'Brownie', qty: 1, mods: '', total: 38 }], payments: [{ method: 'Efectivo', amount: 100 }, { method: 'Tarjeta', amount: 51.8 }], tip: 13.8, total: 151.8, status: 'completada', sync: 'sincronizada', audit: [['11:20', 'Orden creada', 'Sofía Delgado'], ['11:21', 'Comanda enviada', 'Sofía Delgado'], ['11:58', 'Pago dividido registrado', 'Iván Cabrera']] },
    { folio: 'A-1045', day: 0, fecha: 'Hoy · 11:12', creo: 'Sofía Delgado', cobro: 'Sofía Delgado', tipo: 'En local', items: [{ name: 'Frappé biscoff', qty: 1, mods: 'Deslactosada', total: 85 }], payments: [{ method: 'Transferencia', amount: 85 }], tip: 0, total: 85, status: 'completada', sync: 'sincronizada', audit: [['11:08', 'Orden creada', 'Sofía Delgado'], ['11:12', 'Cobro por transferencia', 'Sofía Delgado']] },
    { folio: 'A-1044', day: 0, fecha: 'Hoy · 10:31', creo: 'Sofía Delgado', cobro: '—', tipo: 'Mesa 5', items: [{ name: 'Espresso tonic', qty: 1, mods: '', total: 55 }], payments: [], tip: 0, total: 55, status: 'cancelada', sync: 'sincronizada', motivo: 'Cliente se retiró', audit: [['10:22', 'Orden creada', 'Sofía Delgado'], ['10:31', 'Cancelada · Cliente se retiró', 'Iván Cabrera']] },
    { folio: 'A-1043', day: 0, fecha: 'Hoy · 09:47', creo: 'Iván Cabrera', cobro: 'Iván Cabrera', tipo: 'Para llevar', items: [{ name: 'Capuchino', qty: 2, mods: 'Vainilla +$10', total: 140 }, { name: 'Muffin', qty: 2, mods: '', total: 60 }], payments: [{ method: 'Efectivo', amount: 220 }], tip: 20, total: 220, status: 'completada', sync: 'sincronizada', audit: [['09:44', 'Orden creada', 'Iván Cabrera'], ['09:47', 'Cobro en efectivo', 'Iván Cabrera']] },
    { folio: 'A-1042', day: 0, fecha: 'Hoy · 09:03', creo: 'Sofía Delgado', cobro: 'Sofía Delgado', tipo: 'En local', items: [{ name: 'Cold brew', qty: 1, mods: '', total: 60 }, { name: 'Carlota', qty: 1, mods: '', total: 32 }], payments: [{ method: 'Efectivo', amount: 101.2 }], tip: 9.2, total: 101.2, status: 'completada', sync: 'sincronizada', audit: [['08:59', 'Orden creada', 'Sofía Delgado'], ['09:03', 'Cobro en efectivo', 'Sofía Delgado']] },
    { folio: 'A-1038', day: 3, fecha: '16 jul · 13:22', creo: 'Sofía Delgado', cobro: 'Marcela Ortiz', tipo: 'Mesa 1', items: [{ name: 'Ensalada', qty: 1, mods: 'Pollo · Ranch +$10', total: 65 }, { name: 'Soda kiwi', qty: 1, mods: '', total: 55 }], payments: [{ method: 'Tarjeta', amount: 132 }], tip: 12, total: 132, status: 'reembolsada', sync: 'sincronizada', motivo: 'Platillo equivocado', audit: [['13:02', 'Orden creada', 'Sofía Delgado'], ['13:22', 'Cobro con tarjeta', 'Marcela Ortiz'], ['18:40', 'Reembolso autorizado · Platillo equivocado', 'Marcela Ortiz']] },
    { folio: 'A-1031', day: 6, fecha: '13 jul · 16:05', creo: 'Diego Rentería', cobro: 'Diego Rentería', tipo: 'Domicilio', items: [{ name: 'Frappé oreo', qty: 2, mods: '', total: 150 }, { name: 'Crepa dulce', qty: 1, mods: 'Cajeta', total: 50 }], payments: [{ method: 'Transferencia', amount: 210 }], tip: 10, total: 210, status: 'completada', sync: 'sincronizada', audit: [['15:48', 'Orden creada', 'Diego Rentería'], ['16:05', 'Cobro por transferencia', 'Diego Rentería']] }
  ];

  const seedOrders = [
    { folio: 'A-1048', type: 'mesa', ref: 'Mesa 4', time: '12:12', user: 'Sofía Delgado', prep: 'preparando', sync: 'sincronizada', items: [{ prodId: 'lattes-latte-chai', name: 'Latte chai', qty: 2, mods: { leche: ['avena'] }, modsText: 'Avena +$10', notes: '', unit: 75 }, { prodId: 'postres-carlota', name: 'Carlota', qty: 1, mods: {}, modsText: '', notes: '', unit: 32 }], name: '' },
    { folio: 'A-1049', type: 'llevar', ref: 'Andrea', time: '12:26', user: 'Sofía Delgado', prep: 'en-cola', sync: 'pendiente', items: [{ prodId: 'concafe-americano', name: 'Americano', qty: 1, mods: {}, modsText: '', notes: 'Extra caliente', unit: 50 }, { prodId: 'postres-brownie', name: 'Brownie', qty: 1, mods: {}, modsText: '', notes: '', unit: 38 }], name: 'Andrea' },
    { folio: 'A-1050', type: 'local', ref: 'Barra', time: '12:34', user: 'Iván Cabrera', prep: 'listo', sync: 'conflicto', items: [{ prodId: 'sodas-limonada', name: 'Limonada', qty: 2, mods: {}, modsText: '', notes: 'Sin hielo una', unit: 55 }], name: '' }
  ];

  window.KARMA = { categories, products, modGroups, users, roleLabels, inventory, movements, recipes, sales, seedOrders };
})();

// ES export so entry modules can `import { KARMA }`; the logic still reads the
// `window.KARMA` global set by the IIFE above (zero changes to ported logic).
export const KARMA = window.KARMA;
