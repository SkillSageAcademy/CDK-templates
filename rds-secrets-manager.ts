import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

interface RdsSecretsManagerStackProps {
    databaseName: string;
    dbUsername: string;
    postgresVersion: rds.PostgresEngineVersion;
    instanceType: ec2.InstanceType;
    vpc: ec2.IVpc;
    vpcSubnets: { subnetType: ec2.SubnetType };
    backupWindow: string;
    maintenanceWindow: string;
    databaseSecuritygroup: ec2.ISecurityGroup;
}

export class RdsSecretsManagerStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: RdsSecretsManagerStackProps) {
        super(scope, id);

        // Create a KMS key for encrypting secrets
        const kmsKey = new kms.Key(this, 'SecretsManagerKey');

        const dbSecrets = new secretsmanager.Secret(this, 'SecretsManager', {
            secretName: `${props.databaseName}-credentials`,
            description: `Database Credentials`,
            generateSecretString: {
                passwordLength: 25,
                excludeCharacters: '\\"\'',
                generateStringKey: 'password',
                secretStringTemplate: `{"username":"${props.dbUsername}"}`
            },
            encryptionKey: kmsKey
        });

        // Enable automatic rotation for the secret
        dbSecrets.addRotationSchedule('RotationSchedule', {
            automaticallyAfter: cdk.Duration.days(30)
        });

        // Create a resource-based policy
        const secretPolicy = new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: [dbSecrets.secretArn],
            effect: iam.Effect.ALLOW,
            principals: [new iam.AccountPrincipal(cdk.Aws.ACCOUNT_ID)],
        });

        // Attach the policy to the secret
        dbSecrets.addToResourcePolicy(secretPolicy);

        const postgreCredentials = rds.Credentials.fromSecret(dbSecrets, props.dbUsername);

        new rds.DatabaseInstance(this, 'RDSDatabase', {
            databaseName: props.databaseName,
            instanceIdentifier: props.databaseName,
            credentials: postgreCredentials,
            engine: rds.DatabaseInstanceEngine.postgres({
                version: props.postgresVersion
            }),
            backupRetention: cdk.Duration.days(30),
            allocatedStorage: 30,
            securityGroups: [props.databaseSecuritygroup],
            allowMajorVersionUpgrade: false,
            autoMinorVersionUpgrade: true,
            instanceType: props.instanceType,
            vpc: props.vpc,
            vpcSubnets: props.vpcSubnets,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            storageEncrypted: true,
            monitoringInterval: cdk.Duration.seconds(60),
            enablePerformanceInsights: true,
            parameterGroup: rds.ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.postgres13'),
            preferredBackupWindow: props.backupWindow,
            preferredMaintenanceWindow: props.maintenanceWindow,
            publiclyAccessible: false
        });
    }
}
