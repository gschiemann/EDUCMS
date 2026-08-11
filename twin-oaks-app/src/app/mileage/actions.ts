"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseDateInput, taxYearOf } from "@/lib/dates";

function str(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function createMileage(formData: FormData) {
  const date = parseDateInput(formData.get("date")) ?? new Date();
  const destination = str(formData.get("destination"));
  const purpose = str(formData.get("purpose"));
  if (!destination || !purpose) redirect("/mileage?error=missing");

  const vehicleAssetId = str(formData.get("vehicleAssetId"));
  const startOdometer = num(formData.get("startOdometer"));
  const endOdometer = num(formData.get("endOdometer"));

  const milesInput = num(formData.get("miles"));
  let miles: number;
  if (milesInput != null && milesInput > 0) {
    miles = milesInput;
  } else if (startOdometer != null && endOdometer != null && endOdometer - startOdometer > 0) {
    miles = endOdometer - startOdometer;
  } else {
    redirect("/mileage?error=miles");
  }

  await prisma.mileageLog.create({
    data: {
      date,
      startLocation: str(formData.get("startLocation")),
      destination,
      purpose,
      customerName: str(formData.get("customerName")),
      vehicleAssetId,
      startOdometer,
      endOdometer,
      miles,
      notes: str(formData.get("notes")),
      taxYear: taxYearOf(date),
    },
  });

  // Trips double as the vehicle's odometer log (mirrors addMaintenance → currentHours).
  if (vehicleAssetId != null && endOdometer != null) {
    const asset = await prisma.asset.findUnique({ where: { id: vehicleAssetId } });
    if (asset && (asset.currentMileage == null || endOdometer > asset.currentMileage)) {
      await prisma.asset.update({
        where: { id: vehicleAssetId },
        data: { currentMileage: endOdometer },
      });
    }
  }

  redirect("/mileage");
}

export async function deleteMileage(formData: FormData) {
  const id = str(formData.get("id"));
  if (id) await prisma.mileageLog.delete({ where: { id } });
  redirect("/mileage");
}
