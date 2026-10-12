import { MigrationInterface, QueryRunner } from "typeorm";

export class Actas1791815067465 implements MigrationInterface {
    name = 'Actas1791815067465'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."acta_kind_enum" AS ENUM('ESCRUTINIO', 'RESOLUCION_EMPATE')`);
        await queryRunner.query(`CREATE TABLE "acta" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "electionId" uuid NOT NULL, "version" integer NOT NULL, "kind" "public"."acta_kind_enum" NOT NULL, "snapshot" jsonb NOT NULL, "prevHash" character varying, "hash" character varying NOT NULL, "pendingTies" boolean NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e329d746360e0c58f15ec6c4d56" UNIQUE ("electionId", "version"), CONSTRAINT "PK_c2ec9db9f6e57777d1b074b7f76" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "election" ADD "membersNotifiedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "election" ADD "publicResults" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "acta" ADD CONSTRAINT "FK_516e35e48e8568c9a7a002911c3" FOREIGN KEY ("electionId") REFERENCES "election"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "acta" DROP CONSTRAINT "FK_516e35e48e8568c9a7a002911c3"`);
        await queryRunner.query(`ALTER TABLE "election" DROP COLUMN "publicResults"`);
        await queryRunner.query(`ALTER TABLE "election" DROP COLUMN "membersNotifiedAt"`);
        await queryRunner.query(`DROP TABLE "acta"`);
        await queryRunner.query(`DROP TYPE "public"."acta_kind_enum"`);
    }

}
