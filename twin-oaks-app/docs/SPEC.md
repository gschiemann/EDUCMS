# Twin Oaks OS — Master Build Specification & Checklist

> **This document is the product's source of truth.** It was written by the
> owner and defines what Twin Oaks OS is, what it must do, and in what order
> it gets built. Checkboxes are ticked as features ship; see
> [`ROADMAP.md`](./ROADMAP.md) for the live build-status tracker.

## Purpose

Twin Oaks OS will be the central operating system for Twin Oaks Farm & Tech LLC.

The app should make it extremely easy to:

- Track every dollar earned and spent
- Capture and store every receipt
- Know what expenses may qualify as tax deductions
- Find supporting documentation instantly
- Track farm costs separately from technology/manufacturing costs
- Track individual tractors, printers, equipment, sheep, customers, jobs, and assets
- Produce clean reports for tax preparation
- Understand what each part of the business is actually costing and earning

The app should be simple enough to use every day from an iPhone or iPad
without creating extra bookkeeping work.

---

## 1. Core Design Principles

- ☐ One app for the entire business
- ☐ Every financial transaction has a record
- ☐ Every expense can have a receipt attached
- ☐ Original receipt images/files are permanently stored
- ☐ Every expense has an accounting/tax category
- ☐ Every expense can also have a more detailed internal management category
- ☐ Expenses can be connected to specific equipment, animals, customers, jobs, properties, or projects
- ☐ Records must be searchable
- ☐ Records must be easy to retrieve during tax preparation or an audit
- ☐ The app should never automatically assume an expense is deductible when tax treatment is uncertain
- ☐ Questionable expenses should be flagged for review
- ☐ Accountant-friendly reports and exports must be available
- ☐ Data should be backed up

---

## 2. Main Dashboard

The opening screen should show:

### Company Overview

- ☐ Revenue this month
- ☐ Expenses this month
- ☐ Net profit
- ☐ Year-to-date revenue
- ☐ Year-to-date expenses
- ☐ Year-to-date profit
- ☐ Outstanding invoices
- ☐ Upcoming bills
- ☐ Estimated tax set-aside

### Farm Overview

- ☐ Farm expenses
- ☐ Sheep count
- ☐ Ewes
- ☐ Rams
- ☐ Lambs
- ☐ Upcoming lambing events
- ☐ Health reminders
- ☐ Recent livestock sales

### Tech Overview

- ☐ Open print jobs
- ☐ Jobs awaiting payment
- ☐ Printer activity
- ☐ Filament inventory
- ☐ Tech revenue
- ☐ Tech expenses
- ☐ Tech profit

### Quick Add Button

The app should have a large quick-add button for:

- ☐ Receipt
- ☐ Expense
- ☐ Income
- ☐ Invoice
- ☐ Mileage
- ☐ Print job
- ☐ Sheep event
- ☐ Equipment maintenance

---

## 3. Receipt System

Receipt handling is one of the most important parts of the app.

### Add Receipt

User should be able to:

- ☐ Take a picture
- ☐ Upload a photo
- ☐ Upload a PDF
- ☐ Attach an emailed receipt later

The app should attempt to automatically read:

- ☐ Vendor
- ☐ Date
- ☐ Total
- ☐ Sales tax
- ☐ Payment method
- ☐ Receipt number

User then chooses:

- ☐ Business division
- ☐ Expense category
- ☐ What the purchase belongs to
- ☐ Business purpose
- ☐ Notes

### Receipt Status

- ☐ Categorized
- ☐ Needs review
- ☐ Tax treatment uncertain
- ☐ Personal/business split
- ☐ Reimbursable
- ☐ Archived

---

## 4. Receipt Inbox

There should be a receipt inbox so a receipt can be saved immediately even
when there isn't time to categorize it.

Example: **Take picture → Save to Inbox → Categorize later.**

Inbox should show:

- ☐ Unreviewed receipts
- ☐ Missing categories
- ☐ Missing business purpose
- ☐ Possible duplicate receipts
- ☐ Missing totals
- ☐ Receipts requiring tax review

This prevents receipts from getting lost simply because the user is busy.

---

## 5. Expense Record

Every expense should be capable of storing:

- ☐ Date
- ☐ Vendor
- ☐ Description
- ☐ Amount
- ☐ Tax
- ☐ Payment method
- ☐ Receipt
- ☐ Business division
- ☐ Accounting category
- ☐ Management category
- ☐ Business purpose
- ☐ Associated asset
- ☐ Associated animal
- ☐ Associated job/customer
- ☐ Associated property/project
- ☐ Notes
- ☐ Tax-year designation
- ☐ Tax-review status

---

## 6. Accounting Category vs Management Category

The app must store two levels of classification.

### Accounting Category

Used for bookkeeping/tax preparation. Examples:

- Repairs and maintenance
- Supplies
- Feed
- Veterinary
- Advertising
- Professional services
- Insurance
- Utilities
- Equipment
- Depreciable assets
- Vehicle expense
- Office expense

### Management Category

Used to understand where the money actually went. Examples:

> Repairs & Maintenance → Farm Equipment → Tractor #1 → Hydraulic system

or

> Repairs & Maintenance → Property → Main Barn → Electrical

This allows useful business reporting without making accounting
unnecessarily complicated.

---

## 7. Farm Expense Categories

### Livestock

- ☐ Feed
- ☐ Hay
- ☐ Minerals
- ☐ Supplements
- ☐ Veterinary care
- ☐ Medications
- ☐ Vaccines
- ☐ Dewormer
- ☐ Livestock supplies
- ☐ Ear tags
- ☐ Bedding
- ☐ Breeding expenses
- ☐ Livestock purchases
- ☐ Processing-related expenses when applicable

---

## 8. Property Maintenance

Properties and structures should have their own records.

Possible assets:

- ☐ Main farm
- ☐ Barn
- ☐ Sheep shelter
- ☐ Pasture
- ☐ Fencing
- ☐ Gates
- ☐ Water system
- ☐ Wells
- ☐ Driveways
- ☐ Drainage
- ☐ Storage buildings

Categories:

- ☐ Building repairs
- ☐ Fence repair
- ☐ Gate repair
- ☐ Plumbing
- ☐ Electrical
- ☐ Roofing
- ☐ Lumber/materials
- ☐ Gravel
- ☐ Drainage
- ☐ Mowing
- ☐ Grounds maintenance
- ☐ Water system maintenance
- ☐ Well maintenance
- ☐ Pest control
- ☐ Other property improvements

---

## 9. Equipment Asset Tracking

Every major piece of equipment should have its own profile.

Examples: Tractor #1 · Tractor #2 · Mower · Trailer · Generator ·
Farm implement · 3D printer

### Equipment Profile

- ☐ Equipment name
- ☐ Internal asset ID
- ☐ Manufacturer
- ☐ Model
- ☐ Serial number
- ☐ Year
- ☐ Purchase date
- ☐ Purchase price
- ☐ Seller/vendor
- ☐ Receipt
- ☐ Financing information
- ☐ Warranty
- ☐ Current hours/mileage
- ☐ Photos
- ☐ Documents/manuals
- ☐ Notes

---

## 10. Equipment Maintenance

Every machine should have a maintenance history.

Track:

- ☐ Date
- ☐ Hours/mileage
- ☐ Maintenance performed
- ☐ Parts used
- ☐ Labor
- ☐ Vendor
- ☐ Receipt
- ☐ Cost
- ☐ Notes

Categories:

- ☐ Fuel
- ☐ Oil
- ☐ Oil filters
- ☐ Fuel filters
- ☐ Air filters
- ☐ Hydraulic fluid
- ☐ Hydraulic components
- ☐ Tires
- ☐ Batteries
- ☐ Belts
- ☐ Bearings
- ☐ Electrical repairs
- ☐ Engine repairs
- ☐ Transmission repairs
- ☐ Preventive maintenance
- ☐ Dealer/service work
- ☐ Miscellaneous repairs

The equipment screen should calculate:

- ☐ Total maintenance cost
- ☐ Cost this year
- ☐ Lifetime cost
- ☐ Cost per operating hour when possible
- ☐ Fuel cost
- ☐ Repair history
- ☐ Upcoming service

---

## 11. 3D Printing / Tech Expenses

Categories:

- ☐ Filament
- ☐ Resin if added later
- ☐ Printers
- ☐ Nozzles
- ☐ Hotends
- ☐ Build plates
- ☐ AMS equipment
- ☐ Replacement parts
- ☐ Tools
- ☐ Calipers/measuring tools
- ☐ CAD software
- ☐ Computer equipment
- ☐ iPad/technology
- ☐ Packaging
- ☐ Shipping
- ☐ Labels
- ☐ Fasteners/hardware
- ☐ Electricity allocation
- ☐ Printer maintenance
- ☐ Failed-print waste

---

## 12. 3D Printer Asset Tracking

Every printer should have a profile. Example: **Bambu H2D #1**

Track:

- ☐ Purchase price
- ☐ Purchase date
- ☐ Serial number
- ☐ Printer hours
- ☐ Maintenance
- ☐ Nozzle replacements
- ☐ Build plates
- ☐ Repairs
- ☐ Filament usage
- ☐ Jobs completed
- ☐ Revenue generated
- ☐ Operating cost
- ☐ Profit attributed to printer

---

## 13. Filament Inventory

Every spool can optionally have its own record.

Track:

- ☐ Manufacturer
- ☐ Material
- ☐ Color
- ☐ Purchase price
- ☐ Weight
- ☐ Price per gram
- ☐ Purchase receipt
- ☐ Remaining amount
- ☐ Printer compatibility
- ☐ Jobs used on
- ☐ Waste
- ☐ Inventory status

---

## 14. Customers

Customer profile:

- ☐ Name
- ☐ Company
- ☐ Phone
- ☐ Email
- ☐ Address
- ☐ Notes
- ☐ Quotes
- ☐ Orders
- ☐ Invoices
- ☐ Payments
- ☐ CAD/STL files
- ☐ Purchase history
- ☐ Revenue generated
- ☐ Outstanding balance

---

## 15. Print Jobs

Every manufacturing job should connect:

**Customer → Order → Product/Part → Print Job → Printer → Filament →
Invoice → Payment**

Track:

- ☐ Part number
- ☐ Part description
- ☐ Customer
- ☐ Quantity
- ☐ Printer
- ☐ Material
- ☐ Filament used
- ☐ Print time
- ☐ Failed prints
- ☐ Labor time
- ☐ Packaging
- ☐ Shipping
- ☐ Machine-cost estimate
- ☐ Total cost
- ☐ Sale price
- ☐ Profit
- ☐ Profit per part

---

## 16. Invoicing

Invoices should include:

- ☐ Twin Oaks Farm & Tech information
- ☐ Customer information
- ☐ Invoice number
- ☐ Invoice date
- ☐ Due date
- ☐ Products/services
- ☐ Quantities
- ☐ Unit price
- ☐ Sales tax when applicable
- ☐ Total
- ☐ Payment terms
- ☐ Payment status
- ☐ Notes

Status: ☐ Draft · ☐ Sent · ☐ Viewed · ☐ Partially paid · ☐ Paid ·
☐ Overdue · ☐ Cancelled

---

## 17. Payments

Track:

- ☐ Customer
- ☐ Invoice
- ☐ Date
- ☐ Amount
- ☐ Payment method
- ☐ Check number if applicable
- ☐ Deposit account
- ☐ Notes
- ☐ Attach supporting documentation

---

## 18. Banking

Eventually support:

- ☐ Business checking account
- ☐ Bank transaction import
- ☐ Matching bank transactions with receipts
- ☐ Matching deposits with invoices
- ☐ Reconciliation
- ☐ Transfers
- ☐ Owner contributions
- ☐ Owner draws

The app should identify: **bank transaction with no receipt** and
**receipt with no matching bank transaction**.

---

## 19. Mileage

Track:

- ☐ Date
- ☐ Start location
- ☐ Destination
- ☐ Purpose
- ☐ Associated customer/job/farm activity
- ☐ Start mileage
- ☐ End mileage
- ☐ Total miles
- ☐ Vehicle
- ☐ Notes

Future option: ☐ Automatic GPS trip tracking

---

## 20. Food / Meals

Meals and food purchases should be kept separate because tax treatment
depends on the situation.

Record:

- ☐ Date
- ☐ Restaurant/vendor
- ☐ Amount
- ☐ People involved
- ☐ Business purpose
- ☐ Associated trip/customer/event
- ☐ Receipt

**The system should NOT automatically mark all food purchases as deductible.**

---

## 21. Capital Purchases

Major purchases should be flagged separately.

Examples: ☐ Tractor · ☐ Trailer · ☐ 3D printer · ☐ Computer ·
☐ Large farm equipment · ☐ Buildings · ☐ Major property improvements

Track:

- ☐ Purchase cost
- ☐ Date placed in service
- ☐ Asset category
- ☐ Receipt
- ☐ Financing
- ☐ Tax treatment status
- ☐ Possible depreciation
- ☐ Possible Section 179 eligibility

Final tax treatment should be reviewable by an accountant.

---

## 22. Sheep Management

Every sheep should have a profile.

Track:

- ☐ Animal ID
- ☐ Tag number
- ☐ Photo
- ☐ Breed
- ☐ Sex
- ☐ Birth date/year
- ☐ Sire
- ☐ Dam
- ☐ Birth type
- ☐ Weight
- ☐ Health history
- ☐ Treatments
- ☐ Breeding history
- ☐ Lambing history
- ☐ Sale information
- ☐ Death/loss if applicable
- ☐ Notes

---

## 23. Sheep Events

Quick-add events:

- ☐ Birth
- ☐ Breeding
- ☐ Pregnancy check
- ☐ Lambing
- ☐ Weight
- ☐ Vaccination
- ☐ Medication
- ☐ Deworming
- ☐ Injury
- ☐ Veterinary visit
- ☐ Sale
- ☐ Transfer
- ☐ Death

---

## 24. Livestock Sales

Track:

- ☐ Animal sold
- ☐ Buyer
- ☐ Date
- ☐ Sale price
- ☐ Payment
- ☐ Animal ID
- ☐ Supporting paperwork
- ☐ Buyer receipt/invoice
- ☐ Processing arrangement notes when applicable
- ☐ Profit/cost information

---

## 25. Income Categories

Track separately:

- ☐ 3D-printed product sales
- ☐ Design/CAD services
- ☐ Custom manufacturing
- ☐ Livestock sales
- ☐ Other farm income
- ☐ Other business income

---

## 26. Tax Center

Tax Center should be one of the major sections.

Select: **Tax Year → Division → Category → Transaction → Receipt**

Example:

> 2026 → Farm → Repairs & Maintenance → Tractor #1 → Hydraulic hose →
> $87.42 → View receipt

Tax Center should show:

- ☐ Revenue
- ☐ Expenses
- ☐ Profit/loss
- ☐ Expenses by category
- ☐ Farm expenses
- ☐ Tech expenses
- ☐ Mileage
- ☐ Equipment purchases
- ☐ Capital assets
- ☐ Possible depreciable property
- ☐ Owner contributions
- ☐ Owner draws
- ☐ Tax-review items
- ☐ Missing receipts
- ☐ Uncategorized expenses

---

## 27. Tax Deduction Review

Each expense should have a tax status:

- ☐ Likely business expense
- ☐ Capital asset
- ☐ Mixed personal/business
- ☐ Requires accountant review
- ☐ Missing documentation
- ☐ Not deductible/personal

**The software should organize information and flag possibilities rather
than making final tax-law decisions automatically.**

---

## 28. Tax-Time Document Package

The app should be able to create an accountant package.

Export:

- ☐ Income report
- ☐ Expense report
- ☐ Profit & Loss
- ☐ Category totals
- ☐ Mileage report
- ☐ Asset list
- ☐ Equipment purchases
- ☐ Livestock records when relevant
- ☐ Receipt index
- ☐ Receipt images/PDFs
- ☐ CSV export
- ☐ PDF reports
- ☐ ZIP file containing supporting records

---

## 29. Search

Global search should locate:

- ☐ Receipts
- ☐ Vendors
- ☐ Dollar amounts
- ☐ Dates
- ☐ Equipment
- ☐ Sheep
- ☐ Customers
- ☐ Invoices
- ☐ Part numbers
- ☐ Print jobs
- ☐ Categories

Example search: **"Tractor #1 hydraulic 2026"** should immediately find
every relevant expense, service record, and receipt.

---

## 30. Reports

### Company

- ☐ Profit & Loss
- ☐ Monthly expenses
- ☐ Monthly revenue
- ☐ Expense categories
- ☐ Revenue categories

### Farm

- ☐ Farm profit/loss
- ☐ Feed costs
- ☐ Veterinary costs
- ☐ Property maintenance
- ☐ Equipment costs
- ☐ Cost per sheep/lamb when practical

### Equipment

- ☐ Cost per tractor
- ☐ Annual maintenance
- ☐ Lifetime maintenance
- ☐ Fuel expense
- ☐ Cost per hour

### Tech

- ☐ Revenue per customer
- ☐ Profit per part
- ☐ Profit per print job
- ☐ Printer utilization
- ☐ Filament usage
- ☐ Printer maintenance
- ☐ Failed print cost

---

## 31. Document Storage

Store:

- ☐ Receipts
- ☐ Invoices
- ☐ Quotes
- ☐ Contracts
- ☐ Equipment manuals
- ☐ Warranties
- ☐ Tax documents
- ☐ Business licenses
- ☐ Insurance documents
- ☐ Livestock records
- ☐ CAD files
- ☐ STL/STEP files where practical

Documents should be attachable to the record they belong to.

---

## 32. Data Safety

- ☐ Automatic backups
- ☐ Cloud storage
- ☐ Secure login
- ☐ Face ID/Touch ID
- ☐ Data encryption where appropriate
- ☐ Export/backup capability
- ☐ Never rely on only one copy of important records
- ☐ Ability to restore deleted/changed information where practical

---

## 33. Version 1 — Must Have

The first usable version should concentrate on financial records.

- ☐ Company setup
- ☐ Dashboard
- ☐ Receipt capture
- ☐ Receipt storage
- ☐ Receipt Inbox
- ☐ Expenses
- ☐ Income
- ☐ Categories
- ☐ Equipment/assets
- ☐ Equipment maintenance
- ☐ Search
- ☐ Basic tax reports
- ☐ Receipt drill-down
- ☐ Data backup

## 34. Version 2

- ☐ Customers
- ☐ Quotes
- ☐ Invoices
- ☐ Payments
- ☐ Mileage
- ☐ Bank transaction matching
- ☐ Better tax reports
- ☐ Accountant export

## 35. Version 3

- ☐ Sheep management
- ☐ Lambing
- ☐ Breeding
- ☐ Health records
- ☐ Livestock sales
- ☐ Farm cost analysis

## 36. Version 4

- ☐ 3D-print jobs
- ☐ Filament inventory
- ☐ Printer tracking
- ☐ Job costing
- ☐ Production reporting
- ☐ Profit per part

## 37. Future Features

Possible later additions:

- ☐ Automatic bank feeds
- ☐ Automatic receipt recognition
- ☐ Automatic mileage tracking
- ☐ Email receipt importing
- ☐ Invoice email delivery
- ☐ Online customer payments
- ☐ Inventory barcode scanning
- ☐ Equipment QR codes
- ☐ Sheep tag scanning
- ☐ AI categorization suggestions
- ☐ AI tax-record review
- ☐ Predictive maintenance
- ☐ Mobile notifications
- ☐ Accountant portal
- ☐ Multi-user access

---

## Primary Success Test

Twin Oaks OS is successful if, at tax time, the owner can answer:

> **"Where did this deduction come from?"** — in seconds.

For any reported expense the app should be able to show:

**Category → Transaction → Business purpose → Associated
equipment/animal/job → Vendor → Date → Amount → Original receipt**

The second success test is:

> **"What is this part of my business actually costing me?"**

The app should be able to answer that question for:

- A tractor
- A printer
- A sheep
- A customer
- A print job
- A product
- A property
- The farm division
- The tech division
- Twin Oaks Farm & Tech as a whole
