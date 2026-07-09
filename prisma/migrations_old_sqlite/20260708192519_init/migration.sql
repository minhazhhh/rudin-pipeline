-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "borough" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "units" INTEGER,
    "sqft" INTEGER,
    "deliveryLabel" TEXT NOT NULL,
    "sponsor" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "isRudin" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT NOT NULL,
    "affPct" REAL,
    "mktU" INTEGER,
    "affU" INTEGER,
    "avgSf" INTEGER,
    "affBands" JSONB,
    "compBuildingName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CompBuilding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "propertyType" TEXT NOT NULL,
    "lat" REAL,
    "lng" REAL,
    "underwritten" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "totalN" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CompBuildingStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buildingId" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "avgRent" REAL,
    "medRent" REAL,
    "minRent" REAL,
    "maxRent" REAL,
    "nRent" INTEGER,
    "avgPsf" REAL,
    "medPsf" REAL,
    "minPsf" REAL,
    "maxPsf" REAL,
    "nPsf" INTEGER,
    "avgSf" REAL,
    "medSf" REAL,
    "minSf" REAL,
    "maxSf" REAL,
    "nSf" INTEGER,
    CONSTRAINT "CompBuildingStat_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "CompBuilding" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OverallUnitStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unitType" TEXT NOT NULL,
    "avgRent" REAL,
    "medRent" REAL,
    "minRent" REAL,
    "maxRent" REAL,
    "nRent" INTEGER,
    "avgPsf" REAL,
    "medPsf" REAL,
    "minPsf" REAL,
    "maxPsf" REAL,
    "nPsf" INTEGER,
    "avgSf" REAL,
    "medSf" REAL,
    "minSf" REAL,
    "maxSf" REAL,
    "nSf" INTEGER
);

-- CreateTable
CREATE TABLE "TypeUnitStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyType" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "avgRent" REAL,
    "medRent" REAL,
    "minRent" REAL,
    "maxRent" REAL,
    "nRent" INTEGER,
    "avgPsf" REAL,
    "medPsf" REAL,
    "minPsf" REAL,
    "maxPsf" REAL,
    "nPsf" INTEGER
);

-- CreateTable
CREATE TABLE "TrendPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quarter" TEXT NOT NULL,
    "quarterOrder" INTEGER NOT NULL,
    "unitType" TEXT NOT NULL,
    "avgRent" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "SyncConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "projectsSheetUrl" TEXT,
    "compBuildingsSheetUrl" TEXT,
    "compBuildingStatsSheetUrl" TEXT,
    "overallStatsSheetUrl" TEXT,
    "typeStatsSheetUrl" TEXT,
    "trendSheetUrl" TEXT,
    "lastSyncedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "CompBuilding_name_key" ON "CompBuilding"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CompBuildingStat_buildingId_unitType_key" ON "CompBuildingStat"("buildingId", "unitType");

-- CreateIndex
CREATE UNIQUE INDEX "OverallUnitStat_unitType_key" ON "OverallUnitStat"("unitType");

-- CreateIndex
CREATE UNIQUE INDEX "TypeUnitStat_propertyType_unitType_key" ON "TypeUnitStat"("propertyType", "unitType");

-- CreateIndex
CREATE UNIQUE INDEX "TrendPoint_quarter_unitType_key" ON "TrendPoint"("quarter", "unitType");
