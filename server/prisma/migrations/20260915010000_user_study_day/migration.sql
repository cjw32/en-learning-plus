CREATE TABLE "UserStudyDay" (
  "userId" TEXT NOT NULL,
  "studyDate" VARCHAR(10) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserStudyDay_pkey" PRIMARY KEY ("userId", "studyDate"),
  CONSTRAINT "UserStudyDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
