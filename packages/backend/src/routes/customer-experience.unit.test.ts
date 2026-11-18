import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { buildApp } from '../app';
import { prisma } from '../config/database';
import * as marketing from '../services/restaurant-marketing.service';

describe('WingsLab customer support and stamp card', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ enableRateLimit: false, enableSocketIO: false, enableJobs: false }); });
  beforeEach(() => {
    jest.spyOn(prisma.user,'findUnique').mockResolvedValue({status:'ACTIVE'} as never);
    jest.spyOn(prisma.restaurant,'findUnique').mockResolvedValue({id:'wingslab',userId:'owner',status:'ACTIVE'} as never);
    jest.spyOn(prisma.customer,'findUnique').mockResolvedValue({id:'customer'} as never);
    jest.spyOn(prisma.supportTicket,'create').mockResolvedValue({id:'report',status:'PENDING'} as never);
    jest.spyOn(prisma.supportTicket,'findMany').mockResolvedValue([]);
    jest.spyOn(prisma.supportTicket,'findUnique').mockResolvedValue({id:'report'} as never);
    jest.spyOn(prisma.supportTicket,'update').mockResolvedValue({id:'report',status:'RESOLVED',response:'Listo'} as never);
    jest.spyOn(prisma.order,'findFirst').mockResolvedValue(null);
  });
  afterEach(()=>jest.restoreAllMocks());
  afterAll(async()=>{await app.close();});
  const auth=(role:UserRole)=>({authorization:`Bearer ${app.jwt.sign({sub:'owner',role,phone:'5500000010'})}`});
  it('does not let a customer read or respond to the restaurant inbox', async()=>{
    for(const method of ['GET','PATCH'] as const){const r=await app.inject({method,url:'/restaurant-panel/soporte'+(method==='PATCH'?'/report':''),headers:auth(UserRole.CUSTOMER),...(method==='PATCH'?{payload:{status:'RESOLVED',response:'Listo'}}:{})});expect(r.statusCode).toBe(403);}
    expect(prisma.supportTicket.findMany).not.toHaveBeenCalled();expect(prisma.supportTicket.update).not.toHaveBeenCalled();
  });
  it('rejects reports linked to another customer order',async()=>{
    const r=await app.inject({method:'POST',url:'/customer/support/tickets',headers:auth(UserRole.CUSTOMER),payload:{type:'ORDER',description:'Problema con mi pedido',orderNumber:'other-order'}});
    expect(r.statusCode).toBe(400);expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({customerId:'customer',orderReference:'other-order'})}));expect(prisma.supportTicket.create).not.toHaveBeenCalled();
  });
  it('creates a report and restricts its customer history to the authenticated customer',async()=>{
    const headers=auth(UserRole.CUSTOMER);
    expect((await app.inject({method:'POST',url:'/customer/support/tickets',headers,payload:{type:'APP',subject:'Ayuda',description:'No puedo consultar mi perfil'}})).statusCode).toBe(200);
    expect(prisma.supportTicket.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({customerId:'customer',type:'APP'})}));
    expect((await app.inject({url:'/customer/support/tickets',headers})).statusCode).toBe(200);
    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{customerId:'customer'}}));
  });
  it('restaurant can answer, but cannot save empty responses',async()=>{
    const headers=auth(UserRole.RESTAURANT);
    expect((await app.inject({method:'PATCH',url:'/restaurant-panel/soporte/report',headers,payload:{status:'RESOLVED',response:'   '}})).statusCode).toBe(400);
    expect((await app.inject({method:'PATCH',url:'/restaurant-panel/soporte/report',headers,payload:{status:'RESOLVED',response:'Listo'}})).statusCode).toBe(200);
    expect(prisma.supportTicket.update).toHaveBeenCalledTimes(1);
  });
  it('paginates and filters reports without exposing customer credentials', async () => {
    jest.spyOn(prisma.supportTicket, 'count').mockResolvedValue(23);
    jest.spyOn(prisma.supportTicket, 'groupBy').mockResolvedValue([] as never);
    const r = await app.inject({ url: '/restaurant-panel/soporte/lista?page=2&limit=10&status=PENDING&type=ORDER&search=pollo', headers: auth(UserRole.RESTAURANT) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ total: 23, page: 2, limit: 10 });
    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, where: expect.objectContaining({ status: 'PENDING', type: 'ORDER' }), select: expect.objectContaining({ customer: { select: { user: { select: { name: true, lastName: true } } } } }) }));
  });
  it('scopes review lists to WingsLab and validates filters and roles', async () => {
    const find = jest.spyOn(prisma.review, 'findMany').mockResolvedValue([]);
    jest.spyOn(prisma.review, 'count').mockResolvedValue(0);
    jest.spyOn(prisma.review, 'aggregate').mockResolvedValue({ _avg: { rating: null }, _count: { _all: 0 } } as never);
    const r = await app.inject({ url: '/restaurant-panel/resenas?page=2&rating=5', headers: auth(UserRole.RESTAURANT) });
    expect(r.statusCode).toBe(200);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, where: expect.objectContaining({ restaurantId: expect.any(String), rating: 5 }) }));
    expect((await app.inject({ url: '/restaurant-panel/resenas?rating=9', headers: auth(UserRole.RESTAURANT) })).statusCode).toBe(400);
    expect((await app.inject({ url: '/restaurant-panel/resenas', headers: auth(UserRole.CUSTOMER) })).statusCode).toBe(403);
  });
  it('counts only eligible purchases since activation without creating stamp records',async()=>{
    jest.spyOn(marketing,'getLoyaltyConfiguration').mockResolvedValue({enabled:true,pointsPer100:1,stampGoal:8,stampStartsAt:'2026-11-15T00:00:00Z',rewardDescription:'Regalo'});
    jest.spyOn(prisma.order,'findMany').mockResolvedValue([{id:'old',totalAmount:100,createdAt:new Date('2026-11-14')},{id:'new',totalAmount:100,createdAt:new Date('2026-11-16')}] as never);
    const r=await app.inject({url:'/customer/lealtad',headers:auth(UserRole.CUSTOMER)});
    expect(r.statusCode).toBe(200);expect(r.json().data).toMatchObject({stamps:1,stampGoal:8,redemptionEnabled:false});
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({OR:[{status:{in:['DELIVERED','COMPLETED']}},{status:'PICKED_UP',fulfillmentType:'PICKUP'}]})}));
  });
});
