"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseDateInput } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { ASSET_KINDS, ASSET_STATUSES, DIVISIONS, MAINTENANCE_CATEGORIES } from "@/lib/domain";

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

function assetDataFromForm(formData: FormData) {
  const name = str(formData.get("name"));
  const kind = str(formData.get("kind"));
  const division = str(formData.get("division"));
  if (!name) return null;
  if (!kind || !(ASSET_KINDS as readonly string[]).includes(kind)) return null;
  if (!division || !(DIVISIONS as readonly string[]).includes(division)) return null;

  const status = str(formData.get("status"));
  const year = num(formData.get("year"));

  return {
    name,
    kind,
    division,
    assetTag: str(formData.get("assetTag")),
    manufacturer: str(formData.get("manufacturer")),
    model: str(formData.get("model")),
    serialNumber: str(formData.get("serialNumber")),
    year: year != null ? Math.trunc(year) : null,
    purchaseDate: parseDateInput(formData.get("purchaseDate")),
    purchasePriceCents: parseDollarsToCents(formData.get("purchasePrice")),
    purchasedFrom: str(formData.get("purchasedFrom")),
    financingNotes: str(formData.get("financingNotes")),
    warrantyNotes: str(formData.get("warrantyNotes")),
    currentHours: num(formData.get("currentHours")),
    currentMileage: num(formData.get("currentMileage")),
    notes: str(formData.get("notes")),
    ...(status && (ASSET_STATUSES as readonly string[]).includes(status) ? { status } : {}),
  };
}

export async function createAsset(formData: FormData) {
  const data = assetDataFromForm(formData);
  if (!data) redirect("/assets/new?error=missing");
  const asset = await prisma.asset.create({ data });
  redirect(`/assets/${asset.id}`);
}

export async function updateAsset(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) redirect("/assets");
  const data = assetDataFromForm(formData);
  if (!data) redirect(`/assets/${id}/edit?error=missing`);
  await prisma.asset.update({ where: { id }, data });
  redirect(`/assets/${id}`);
}

export async function addMaintenance(formData: FormData) {
  const assetId = str(formData.get("assetId"));
  if (!assetId) redirect("/assets");

  const category = str(formData.get("category"));
  const description = str(formData.get("description"));
  if (!description || !category || !(MAINTENANCE_CATEGORIES as readonly string[]).includes(category)) {
    redirect(`/assets/${assetId}?error=missing`);
  }

  const hoursAtService = num(formData.get("hoursAtService"));

  await prisma.maintenanceRecord.create({
    data: {
      assetId,
      date: parseDateInput(formData.get("date")) ?? new Date(),
      hoursAtService,
      category,
      description,
      partsCostCents: parseDollarsToCents(formData.get("partsCost")),
      laborCostCents: parseDollarsToCents(formData.get("laborCost")),
      vendorName: str(formData.get("vendorName")),
      notes: str(formData.get("notes")),
    },
  });

  // Service entries double as the machine's hour-meter log.
  if (hoursAtService != null) {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (asset && (asset.currentHours == null || hoursAtService > asset.currentHours)) {
      await prisma.asset.update({
        where: { id: assetId },
        data: { currentHours: hoursAtService },
      });
    }
  }

  redirect(`/assets/${assetId}`);
}

export async function deleteMaintenance(formData: FormData) {
  const id = str(formData.get("id"));
  const assetId = str(formData.get("assetId"));
  if (id) await prisma.maintenanceRecord.delete({ where: { id } });
  redirect(assetId ? `/assets/${assetId}` : "/assets");
}
