-- CreateIndex
CREATE UNIQUE INDEX "Region_state_city_name_key" ON "Region"("state", "city", "name");
