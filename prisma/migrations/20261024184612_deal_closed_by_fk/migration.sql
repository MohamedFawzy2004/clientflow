-- DropForeignKey
ALTER TABLE "deals" DROP CONSTRAINT "deals_agency_id_closed_by_id_fkey";

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

