import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

export class S3LifecycleCdkStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Create an S3 bucket
        const bucket = new s3.Bucket(this, 'MyBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Not recommended for production, used for demo purposes
            autoDeleteObjects: true, // Automatically delete objects when bucket is deleted
        });

        // Define lifecycle policy
        bucket.addLifecycleRule({
            enabled: true,
            transitions: [
                {
                    storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                    transitionAfter: cdk.Duration.days(90), // Transition to IA after 90 days
                },
                {
                    storageClass: s3.StorageClass.DEEP_ARCHIVE,
                    transitionAfter: cdk.Duration.days(180), // Transition to Deep Archive after 180 days
                },
            ],
            expiration: cdk.Duration.days(365), // Delete objects after 1 year
        });

        // Example: Deploy a file to the S3 bucket
        new s3deploy.BucketDeployment(this, 'DeployFiles', {
            sources: [s3deploy.Source.asset('./sample-files')],
            destinationBucket: bucket,
        });
    }
}