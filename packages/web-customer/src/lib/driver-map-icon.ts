/** Marcador compartido para la ubicación del repartidor en Google Maps. */
export function buildDriverMapIcon(google: any) {
  return {
    url: '/seguimiento-moto-mapa.png',
    scaledSize: new google.maps.Size(40, 35),
    anchor: new google.maps.Point(20, 32),
  };
}
