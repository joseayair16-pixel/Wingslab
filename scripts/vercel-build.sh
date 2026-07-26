#!/bin/bash
set -e
echo "Building @sadel/shared..."
npm run build -w @sadel/shared

case "$VERCEL_PROJECT_NAME" in
  *customer)
    echo "Building @sadel/web-customer..."
    npm run build -w @sadel/web-customer
    ;;
  *restaurant)
    echo "Building @sadel/web-restaurant..."
    npm run build -w @sadel/web-restaurant
    ;;
  *driver)
    echo "Building @sadel/web-driver..."
    npm run build -w @sadel/web-driver
    ;;
  *admin)
    echo "Building @sadel/web-admin..."
    npm run build -w @sadel/web-admin
    ;;
  *)
    echo "Unknown Vercel project: $VERCEL_PROJECT_NAME"
    exit 1
    ;;
esac
