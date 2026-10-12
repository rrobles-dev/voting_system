import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1791808536752 implements MigrationInterface {
    name = 'Init1791808536752'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."election_status_enum" AS ENUM('DRAFT', 'OPEN', 'CLOSED', 'TALLIED')`);
        await queryRunner.query(`CREATE TABLE "election" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "description" text, "status" "public"."election_status_enum" NOT NULL DEFAULT 'DRAFT', "opensAt" TIMESTAMP WITH TIME ZONE NOT NULL, "closesAt" TIMESTAMP WITH TIME ZONE NOT NULL, "codeLength" integer NOT NULL DEFAULT '9', "quorumPercent" integer, "retentionDays" integer NOT NULL DEFAULT '90', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_17467b9ade12257d01912737bdb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "position" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "electionId" uuid NOT NULL, "name" character varying NOT NULL, "seats" integer NOT NULL, "minSelection" integer NOT NULL DEFAULT '0', "maxSelection" integer NOT NULL, "sortOrder" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_b7f483581562b4dc62ae1a5b7e2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "candidate" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "positionId" uuid NOT NULL, "name" character varying NOT NULL, "detail" text, "sortOrder" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_b0ddec158a9a60fbc785281581b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "voter" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "electionId" uuid NOT NULL, "externalRef" character varying NOT NULL, "organization" character varying NOT NULL, "email" character varying NOT NULL, "weight" integer NOT NULL DEFAULT '1', "eligible" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_fc772aea5729820fcdc7d81c7ce" UNIQUE ("electionId", "externalRef"), CONSTRAINT "PK_c1a0d8fd992c199219325d43705" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."access_code_status_enum" AS ENUM('ACTIVE', 'USED', 'INVALIDATED')`);
        await queryRunner.query(`CREATE TABLE "access_code" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "voterId" uuid NOT NULL, "codeHash" character varying NOT NULL, "status" "public"."access_code_status_enum" NOT NULL DEFAULT 'ACTIVE', "issuedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "usedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_31c26435c0d26a2ce6bee4a763b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9c5de6875d209f78228eae5313" ON "access_code" ("codeHash") `);
        await queryRunner.query(`CREATE TABLE "participation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "electionId" uuid NOT NULL, "voterId" uuid NOT NULL, "codeId" uuid NOT NULL, "votedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "ipEnc" text, "uaEnc" text, "annulled" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_62db9bd4b9cee428d0b3d3c6e24" UNIQUE ("codeId"), CONSTRAINT "REL_62db9bd4b9cee428d0b3d3c6e2" UNIQUE ("codeId"), CONSTRAINT "PK_ba5442bab90fc96ddde456c69e1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."ballot_status_enum" AS ENUM('VALID', 'ANNULLED')`);
        await queryRunner.query(`CREATE TABLE "ballot" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "electionId" uuid NOT NULL, "receiptHash" character varying NOT NULL, "castHour" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."ballot_status_enum" NOT NULL DEFAULT 'VALID', CONSTRAINT "PK_20adac0e902c60e62fcb6f4cf9c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f4736e47f1e047080dee9eb238" ON "ballot" ("receiptHash") `);
        await queryRunner.query(`CREATE TABLE "ballot_selection" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ballotId" uuid NOT NULL, "candidateId" uuid NOT NULL, CONSTRAINT "UQ_88bce51b0db952d17df7d53c14f" UNIQUE ("ballotId", "candidateId"), CONSTRAINT "PK_1f2d61e1228205f993d8f79c68e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."annulment_status_enum" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED')`);
        await queryRunner.query(`CREATE TABLE "annulment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "electionId" uuid NOT NULL, "ballotId" uuid NOT NULL, "voterId" character varying NOT NULL, "reason" text NOT NULL, "status" "public"."annulment_status_enum" NOT NULL DEFAULT 'REQUESTED', "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolvedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_5c433df4def0d5a1be6e390587d" UNIQUE ("ballotId"), CONSTRAINT "REL_5c433df4def0d5a1be6e390587" UNIQUE ("ballotId"), CONSTRAINT "PK_663c301cdb356078d3825cb19ab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "audit_event" ("seq" SERIAL NOT NULL, "electionId" uuid, "type" character varying NOT NULL, "actor" character varying NOT NULL, "payload" jsonb NOT NULL, "prevHash" character varying NOT NULL, "hash" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_53300da00860bdf4dc3ef7daae6" PRIMARY KEY ("seq"))`);
        await queryRunner.query(`ALTER TABLE "position" ADD CONSTRAINT "FK_151029211e89bb986beb2321dbb" FOREIGN KEY ("electionId") REFERENCES "election"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "candidate" ADD CONSTRAINT "FK_8f3ea72c7542372a4e9cadbfbdf" FOREIGN KEY ("positionId") REFERENCES "position"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "voter" ADD CONSTRAINT "FK_471e9b166f82640515f11c25b71" FOREIGN KEY ("electionId") REFERENCES "election"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "access_code" ADD CONSTRAINT "FK_3a6b16180d9d0741966731dda93" FOREIGN KEY ("voterId") REFERENCES "voter"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "participation" ADD CONSTRAINT "FK_4bd99aec56df885db79a2ac2597" FOREIGN KEY ("electionId") REFERENCES "election"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "participation" ADD CONSTRAINT "FK_0af275d55fdfbb41df213e627c8" FOREIGN KEY ("voterId") REFERENCES "voter"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "participation" ADD CONSTRAINT "FK_62db9bd4b9cee428d0b3d3c6e24" FOREIGN KEY ("codeId") REFERENCES "access_code"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ballot" ADD CONSTRAINT "FK_7d86dfb311d67595c52462ce0b2" FOREIGN KEY ("electionId") REFERENCES "election"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ballot_selection" ADD CONSTRAINT "FK_6798ddc1d93d644a5802b4d626b" FOREIGN KEY ("ballotId") REFERENCES "ballot"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ballot_selection" ADD CONSTRAINT "FK_c5a2a1ce1dbec17351d79b5addf" FOREIGN KEY ("candidateId") REFERENCES "candidate"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "annulment" ADD CONSTRAINT "FK_fa83a1803a76637a5810f2262b2" FOREIGN KEY ("electionId") REFERENCES "election"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "annulment" ADD CONSTRAINT "FK_5c433df4def0d5a1be6e390587d" FOREIGN KEY ("ballotId") REFERENCES "ballot"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "annulment" DROP CONSTRAINT "FK_5c433df4def0d5a1be6e390587d"`);
        await queryRunner.query(`ALTER TABLE "annulment" DROP CONSTRAINT "FK_fa83a1803a76637a5810f2262b2"`);
        await queryRunner.query(`ALTER TABLE "ballot_selection" DROP CONSTRAINT "FK_c5a2a1ce1dbec17351d79b5addf"`);
        await queryRunner.query(`ALTER TABLE "ballot_selection" DROP CONSTRAINT "FK_6798ddc1d93d644a5802b4d626b"`);
        await queryRunner.query(`ALTER TABLE "ballot" DROP CONSTRAINT "FK_7d86dfb311d67595c52462ce0b2"`);
        await queryRunner.query(`ALTER TABLE "participation" DROP CONSTRAINT "FK_62db9bd4b9cee428d0b3d3c6e24"`);
        await queryRunner.query(`ALTER TABLE "participation" DROP CONSTRAINT "FK_0af275d55fdfbb41df213e627c8"`);
        await queryRunner.query(`ALTER TABLE "participation" DROP CONSTRAINT "FK_4bd99aec56df885db79a2ac2597"`);
        await queryRunner.query(`ALTER TABLE "access_code" DROP CONSTRAINT "FK_3a6b16180d9d0741966731dda93"`);
        await queryRunner.query(`ALTER TABLE "voter" DROP CONSTRAINT "FK_471e9b166f82640515f11c25b71"`);
        await queryRunner.query(`ALTER TABLE "candidate" DROP CONSTRAINT "FK_8f3ea72c7542372a4e9cadbfbdf"`);
        await queryRunner.query(`ALTER TABLE "position" DROP CONSTRAINT "FK_151029211e89bb986beb2321dbb"`);
        await queryRunner.query(`DROP TABLE "audit_event"`);
        await queryRunner.query(`DROP TABLE "annulment"`);
        await queryRunner.query(`DROP TYPE "public"."annulment_status_enum"`);
        await queryRunner.query(`DROP TABLE "ballot_selection"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f4736e47f1e047080dee9eb238"`);
        await queryRunner.query(`DROP TABLE "ballot"`);
        await queryRunner.query(`DROP TYPE "public"."ballot_status_enum"`);
        await queryRunner.query(`DROP TABLE "participation"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9c5de6875d209f78228eae5313"`);
        await queryRunner.query(`DROP TABLE "access_code"`);
        await queryRunner.query(`DROP TYPE "public"."access_code_status_enum"`);
        await queryRunner.query(`DROP TABLE "voter"`);
        await queryRunner.query(`DROP TABLE "candidate"`);
        await queryRunner.query(`DROP TABLE "position"`);
        await queryRunner.query(`DROP TABLE "election"`);
        await queryRunner.query(`DROP TYPE "public"."election_status_enum"`);
    }

}
