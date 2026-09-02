import { Prisma } from '@prisma/client';

const orderBaseScalarSelect = {
  id: true,
  orderReference: true,
  restaurantId: true,
  customerId: true,
  driverId: true,
  addressId: true,
  supportRestaurantId: true,
  isSupportRequested: true,
  supportRequestedAt: true,
  supportCount: true,
  supportRejectionCount: true,
  supportAttempts: true,
  latitude: true,
  longitude: true,
  subtotal: true,
  taxAmount: true,
  serviceFee: true,
  deliveryFee: true,
  totalAmount: true,
  promoCode: true,
  promoDiscountAmount: true,
  discountBreakdown: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  paymentProofUrl: true,
  estimatedDeliveryTime: true,
  actualDeliveryTime: true,
  preparationTimeMinutes: true,
  preparationStartedAt: true,
  preparationDeadlineAt: true,
  etaExtendedMinutes: true,
  notes: true,
  handoverPin: true,
  handoverPinAttempts: true,
  handoverPinUpdatedAt: true,
  deliveryPin: true,
  pickedUpAt: true,
  inTransitAt: true,
  deliveredAt: true,
  createdAt: true,
  updatedAt: true,
  dailyCounter: true,
  noDriversAvailable: true,
  deliveryPreference: true,
  driverAssignedAt: true,
  isAcceptedByDriver: true,
  cashPaymentConfirmedAt: true,
  scheduledDeliveryAt: true,
  scheduledDeliveryCustomerAcceptedAt: true,
  readyAt: true,
  driverArrivedAt: true,
  driverArrivedAtCustomer: true,
  lastDriverLatitude: true,
  lastDriverLongitude: true,
  lastDriverLocationAt: true,
  lastArrivalReminderSentAt: true,
  noShowReleasedAt: true,
  lastPickupAlertedAt: true,
  batchId: true,
  deliverySequence: true,
  deliveredByRestaurant: true,
  cancellationRequestedAt: true,
  cancelledBy: true,
  cancellationReason: true,
  cancellationRejectedAt: true,
  cancellationRequestCount: true,
  fulfillmentType: true,
  deliveryDistanceKm: true,
  pickupReadyAt: true,
  nearlyReadySentAt: true,
  completedAt: true,
  pickupPin: true,
} satisfies Prisma.OrderSelect;

const addressSelect = {
  id: true,
  customerId: true,
  street: true,
  number: true,
  apartment: true,
  neighborhood: true,
  city: true,
  state: true,
  zipCode: true,
  country: true,
  reference: true,
  latitude: true,
  longitude: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AddressSelect;

const orderItemWithProductSelect = {
  id: true,
  orderId: true,
  productId: true,
  quantity: true,
  unitPrice: true,
  subtotal: true,
  specialInstructions: true,
  sellBy: true,
  weightG: true,
  createdAt: true,
  options: {
    select: {
      id: true,
      optionId: true,
      name: true,
      price: true,
    },
  },
  product: {
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      image: true,
      categoryId: true,
      isAvailable: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.OrderItemSelect;

const trackingSelect = {
  id: true,
  orderId: true,
  status: true,
  latitude: true,
  longitude: true,
  notes: true,
  createdAt: true,
} satisfies Prisma.OrderTrackingSelect;

export const restaurantOrderListSelect = Prisma.validator<Prisma.OrderSelect>()({
  ...orderBaseScalarSelect,
  customer: {
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          lastName: true,
          phone: true,
          profilePhoto: true,
        },
      },
    },
  },
  driver: {
    select: {
      id: true,
      userId: true,
      status: true,
      region: true,
      availability: true,
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
    },
  },
  address: {
    select: addressSelect,
  },
  items: {
    select: orderItemWithProductSelect,
  },
  restaurant: {
    select: {
      id: true,
      name: true,
      hasOwnDelivery: true,
    },
  },
  supportRestaurant: {
    select: {
      id: true,
      name: true,
      contactPhone: true,
    },
  },
});

export const restaurantScopedOrderSelect = Prisma.validator<Prisma.OrderSelect>()({
  ...restaurantOrderListSelect,
  restaurant: {
    select: {
      id: true,
      userId: true,
      name: true,
      businessType: true,
      address: true,
      description: true,
      contactPhone: true,
      email: true,
      region: true,
      latitude: true,
      longitude: true,
      minDeliveryTime: true,
      maxDeliveryTime: true,
      deliveryFee: true,
      hasOwnDelivery: true,
      transferBankName: true,
      transferAccountNumber: true,
      transferBeneficiaryName: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  tracking: {
    select: trackingSelect,
    orderBy: { createdAt: 'asc' },
  },
});

export const restaurantOrderWorkflowSelect = Prisma.validator<Prisma.OrderSelect>()({
  ...orderBaseScalarSelect,
  restaurant: {
    select: {
      id: true,
      userId: true,
      name: true,
      businessType: true,
      hasOwnDelivery: true,
      latitude: true,
      longitude: true,
      maxDeliveryTime: true,
    },
  },
  customer: {
    select: {
      id: true,
      user: {
        select: {
          id: true,
          name: true,
          profilePhoto: true,
        },
      },
    },
  },
  driver: {
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
    },
  },
  tracking: {
    select: trackingSelect,
    orderBy: { createdAt: 'asc' },
  },
});

export const customerOrderListSelect = Prisma.validator<Prisma.OrderSelect>()({
  ...orderBaseScalarSelect,
  restaurant: {
    select: {
      id: true,
      name: true,
      businessType: true,
      logo: true,
      address: true,
      latitude: true,
      longitude: true,
    },
  },
  address: {
    select: addressSelect,
  },
  review: {
    select: {
      id: true,
    },
  },
});

export const customerOrderDetailSelect = Prisma.validator<Prisma.OrderSelect>()({
  ...orderBaseScalarSelect,
  items: {
    select: {
      id: true,
      orderId: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      subtotal: true,
      specialInstructions: true,
      sellBy: true,
      weightG: true,
      createdAt: true,
      options: {
        select: {
          id: true,
          optionId: true,
          name: true,
          price: true,
        },
      },
      product: {
        select: {
          id: true,
          name: true,
          image: true,
        },
      },
    },
  },
  address: {
    select: addressSelect,
  },
  restaurant: {
    select: {
      id: true,
      name: true,
      businessType: true,
      logo: true,
      contactPhone: true,
      address: true,
      latitude: true,
      longitude: true,
    },
  },
  driver: {
    select: {
      id: true,
      rating: true,
      user: {
        select: {
          name: true,
          phone: true,
        },
      },
    },
  },
  tracking: {
    select: trackingSelect,
    orderBy: { createdAt: 'asc' },
  },
  review: {
    select: {
      id: true,
    },
  },
});

export const customerCreatedOrderSelect = Prisma.validator<Prisma.OrderSelect>()({
  ...orderBaseScalarSelect,
  items: {
    select: {
      id: true,
      orderId: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      subtotal: true,
      specialInstructions: true,
      sellBy: true,
      weightG: true,
      createdAt: true,
      options: {
        select: {
          id: true,
          optionId: true,
          name: true,
          price: true,
        },
      },
      product: {
        select: {
          id: true,
          name: true,
          price: true,
        },
      },
    },
  },
  address: {
    select: {
      id: true,
    },
  },
  restaurant: {
    select: {
      id: true,
      userId: true,
      name: true,
      hasOwnDelivery: true,
      deliveryFee: true,
      latitude: true,
      longitude: true,
      maxDeliveryTime: true,
    },
  },
  customer: {
    select: {
      id: true,
      user: {
        select: {
          id: true,
          name: true,
          lastName: true,
          phone: true,
          profilePhoto: true,
        },
      },
    },
  },
  tracking: {
    select: trackingSelect,
    orderBy: { createdAt: 'asc' },
  },
});

export const driverScopedOrderSelect = Prisma.validator<Prisma.OrderSelect>()({
  ...orderBaseScalarSelect,
  restaurant: {
    select: {
      id: true,
      userId: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      maxDeliveryTime: true,
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
    },
  },
  customer: {
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
          profilePhoto: true,
        },
      },
    },
  },
  address: {
    select: addressSelect,
  },
  items: {
    select: orderItemWithProductSelect,
  },
  driver: {
    select: {
      id: true,
      userId: true,
      status: true,
      region: true,
      availability: true,
      platformFeePerOrder: true,
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
    },
  },
  tracking: {
    select: trackingSelect,
    orderBy: { createdAt: 'asc' },
  },
});

export const driverActiveOrderListSelect = Prisma.validator<Prisma.OrderSelect>()({
  ...orderBaseScalarSelect,
  isAcceptedByDriver: true,
  deliveryPreference: true,
  restaurant: {
    select: {
      id: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      maxDeliveryTime: true,
      businessType: true,
      user: {
        select: {
          phone: true,
        },
      },
    },
  },
  customer: {
    select: {
      user: {
        select: {
          name: true,
          phone: true,
          profilePhoto: true,
        },
      },
    },
  },
  address: {
    select: addressSelect,
  },
  items: {
    select: orderItemWithProductSelect,
  },
  tracking: {
    select: trackingSelect,
    orderBy: { createdAt: 'asc' },
  },
});


export const driverHistoryOrderListSelect = Prisma.validator<Prisma.OrderSelect>()({
  ...orderBaseScalarSelect,
  restaurant: {
    select: {
      id: true,
      name: true,
    },
  },
  customer: {
    select: {
      user: {
        select: {
          name: true,
        },
      },
    },
  },
  address: {
    select: addressSelect,
  },
});
