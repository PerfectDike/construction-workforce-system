ALTER TABLE "Allocation" ADD CONSTRAINT "allocation_positive_hours" CHECK ("allocatedHours" > 0);
