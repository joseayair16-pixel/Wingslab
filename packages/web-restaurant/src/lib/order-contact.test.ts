import {
  customerPhoneHref,
  formatCustomerAddress,
  formatCustomerName,
  formatCustomerPhone,
} from './order-contact';

describe('order contact presentation', () => {
  it('shows every surname instead of truncating the customer name', () => {
    expect(formatCustomerName({ name: 'WingsLab', lastName: 'Prueba Firebase' })).toBe('WingsLab Prueba Firebase');
    expect(formatCustomerName({ name: '  Ana ', lastName: '  López García ' })).toBe('Ana López García');
    expect(formatCustomerName({ name: 'SoloNombre' })).toBe('SoloNombre');
    expect(formatCustomerName({ lastName: 'Apellido' })).toBe('Apellido');
    expect(formatCustomerName(null)).toBe('');
  });

  it('always renders a phone label and a safe tel href', () => {
    expect(formatCustomerPhone('4591153960')).toBe('4591153960');
    expect(formatCustomerPhone(null)).toBe('Teléfono no disponible');
    expect(customerPhoneHref('45 91 15 39 60')).toBe('tel:4591153960');
    expect(customerPhoneHref('+52 459 115 3960')).toBe('tel:+524591153960');
    expect(customerPhoneHref('  ')).toBeNull();
    expect(customerPhoneHref('sin numero')).toBeNull();
  });

  it('builds a complete address and never leaks undefined or null', () => {
    const full = formatCustomerAddress({
      street: 'Calle Libertad',
      number: '405',
      apartment: '2A',
      neighborhood: 'Morelos',
      city: 'Ciudad de México',
      state: 'CDMX',
      zipCode: '06000',
      country: 'México',
      reference: 'casa negra',
    });
    expect(full).toBe('Calle Libertad 405, Depto. 2A, Morelos, Ciudad de México, CDMX, 06000, México · Ref: casa negra');

    const partial = formatCustomerAddress({
      street: 'Calle Libertad',
      number: '405',
      neighborhood: 'Morelos',
      reference: 'casa negra',
    });
    expect(partial).toBe('Calle Libertad 405, Morelos · Ref: casa negra');

    expect(formatCustomerAddress(null)).toBe('Dirección no disponible.');
    expect(formatCustomerAddress({ street: '  ', reference: null })).toBe('Dirección no disponible.');
    expect(formatCustomerAddress({})).not.toMatch(/undefined|null/);
  });
});
