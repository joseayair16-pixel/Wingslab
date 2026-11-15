import { isChatOrderActive } from './order-chat.routes';
test.each(['PENDING','CONFIRMED','PREPARING','READY','PICKED_UP','IN_TRANSIT'])('chat remains open during %s', status => expect(isChatOrderActive(status)).toBe(true));
test.each(['DELIVERED','COMPLETED','CANCELLED','REJECTED'])('chat closes after %s', status => expect(isChatOrderActive(status)).toBe(false));
